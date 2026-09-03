'use strict';

// Fetches a video's media over SABR a segment at a time, keeping only what is near the
// playhead.

const { mkdir, rm, writeFile } = require('fs/promises');
const { join } = require('path');

const journal = require('./journal.js');
const mp4 = require('./mp4.js');
const webm = require('./webm.js');
const sabr = require('./sabr.js');

const MEDIA_DIR = process.env.TUBE_MEDIA_DIR || '/home/owner/share/tube/media';

const SEGMENT_WAIT = 30000;
const INDEX_WAIT = 10000;

// Segments ahead of the player the download may get.
const READ_AHEAD = 10;

// A narrower window while the decoder is starting on 2160p60, which is when frames drop.
const READ_AHEAD_AT_FIRST = 8;

// Segments behind the player that are kept rather than deleted. Deleting one a player
// asks for again after a stall sends the download backwards, discarding its read-ahead.
const KEEP_BEHIND = 15;

// Tries at a quarter of a second each.
const POSITION_TRIES = 40;

// Segments before a resume position to begin at, so the element's own first request is
// already being fetched rather than costing a second restart.
const LEAD_IN = 2;

const IDLE_TIMEOUT = 45 * 1000;
const SWEEP_INTERVAL = 15 * 1000;
const HEAD_BYTES = 128 * 1024;

const MP4 = /^(video|audio)\/mp4/;
const WEBM = /^(video|audio)\/webm/;

const preIndexed = (format) => format.type !== 'FORMAT_STREAM_TYPE_OTF';

function isHdr(format) {
    const colour = format.colorInfo || {};
    if (colour.primaries !== 'COLOR_PRIMARIES_BT2020') return false;

    return colour.transferCharacteristics === 'COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084'
        || colour.transferCharacteristics === 'COLOR_TRANSFER_CHARACTERISTICS_ARIB_STD_B67';
}

// AV1 and long-form VP9 put the depth in the fourth field of the codec string; VP9's
// short form names only its profile, of which 2 and 3 are the ten-bit ones.
function isTenBit(format) {
    const codec = (/codecs="([^"]+)"/.exec(format.mimeType || '') || [])[1] || '';

    if (codec.indexOf('av01.') === 0 || codec.indexOf('vp09.') === 0) {
        const depth = codec.split('.')[3];
        return depth === '10' || depth === '12';
    }

    return /^vp9\.(2|3)$/.test(codec);
}

const sessions = new Map();

class Track {
    constructor(kind, format, dir) {
        this.kind = kind;
        this.format = format;
        this.dir = dir;

        this.index = null;
        this.have = new Set();
        this.waiting = new Map();

        this.running = false;
        this.wanted = 0;
        this.next = 0;
        this.from = 0;
        this.restartAt = null;
        this.stopped = false;
        this.failure = null;
    }

    seekTo(number) {
        if (this.restartAt === number) return;

        journal.service('seek', `${this.kind} to segment ${number} (at ${this.next}, holds ${this.have.size})`);
        this.restartAt = number;
        if (this.abort) {
            try { this.abort(); } catch (e) {}
        }
    }

    // A stream that has ended or is parked never reaches anything, however close it stands,
    // so being within read-ahead is not on its own enough.
    reachable(number) {
        if (!this.running) return false;

        return number >= this.next && number <= this.next + READ_AHEAD;
    }

    file(number) {
        return join(this.dir, number === 0 ? 'init.mp4' : `${number}.m4s`);
    }

    reach(number) {
        if (this.have.has(number)) return Promise.resolve();
        if (this.failure) return Promise.reject(this.failure);
        if (this.stopped) return Promise.reject(new Error(`${this.kind} is no longer being fetched`));

        if (number > 0 && this.index && !this.reachable(number)) this.seekTo(number);

        return new Promise((resolve, reject) => {
            const waiters = this.waiting.get(number) || [];
            const timer = setTimeout(() => {
                this.waiting.delete(number);
                reject(new Error(`${this.kind} segment ${number} did not arrive in time`));
            }, SEGMENT_WAIT);

            waiters.push({ resolve, reject, timer });
            this.waiting.set(number, waiters);
        });
    }

    arrived(number) {
        this.have.add(number);

        (this.waiting.get(number) || []).forEach((waiter) => {
            clearTimeout(waiter.timer);
            waiter.resolve();
        });
        this.waiting.delete(number);
    }

    broke(error) {
        journal.service('broke', `${this.kind}: ${error.message}`);
        this.failure = error;

        this.waiting.forEach((waiters) => waiters.forEach((waiter) => {
            clearTimeout(waiter.timer);
            waiter.reject(error);
        }));
        this.waiting.clear();
    }

    want(number) {
        this.wanted = number;
    }

    get behind() {
        return Math.max(this.wanted, this.from ? this.from - 1 : 0);
    }

    get satisfied() {
        const allowed = Math.min(READ_AHEAD, READ_AHEAD_AT_FIRST + this.behind);
        return this.next - this.behind >= allowed;
    }

    forgetBehind() {
        const oldest = this.wanted - KEEP_BEHIND;

        const gone = [...this.have].filter((number) =>
            number > 0 && (number < oldest || number > this.next));

        gone.forEach((number) => this.have.delete(number));

        return Promise.all(gone.map((number) => rm(this.file(number), { force: true })
            .catch(() => {})));
    }
}

function pick(formats, kind, maxHeight, chosen, xtags, hdr) {
    // Picture may be WebM; sound stays MP4. VP9 is the only 2160p60 this hardware decodes
    // without dropping frames, and it is never offered in anything but WebM.
    const container = kind === 'video'
        ? (format) => MP4.test(format.mimeType || '') || WEBM.test(format.mimeType || '')
        : (format) => MP4.test(format.mimeType || '');

    const wanted = formats
        .filter(container)
        .filter(preIndexed)
        .filter((format) => (kind === 'video' ? !!format.height : !format.height));

    // Which audio the viewer is meant to hear is YouTube's choice, named exactly by `xtags`.
    // An empty one means the default track, so it is distinct from not being told.
    if (kind === 'audio') {
        if (typeof xtags === 'string') {
            const said = wanted.filter((format) => (format.xtags || '') === xtags);
            if (said.length) return said[0];
        }

        const asChosen = wanted.filter((format) => (chosen || []).some((one) =>
            one.itag === format.itag && (one.xtags || '') === (format.xtags || '')));

        return asChosen[0] || wanted.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0] || null;
    }

    // Never by what the player last asked for: it starts on a low rung and works upwards, so
    // following it would take a viewer who chose 2160p straight back down.
    const offered = wanted.filter((format) => !maxHeight || format.height <= maxHeight);

    // Tallest, then fastest, then the wider colour, then the shallower depth, then MP4.
    // Colour rather than depth: ten bits on BT.709 material is only a bigger file.
    const best = (formats) => formats
        .sort((a, b) => (b.height - a.height)
            || ((b.fps || 30) - (a.fps || 30))
            || (hdr ? (isHdr(b) ? 1 : 0) - (isHdr(a) ? 1 : 0) : (isHdr(a) ? 1 : 0) - (isHdr(b) ? 1 : 0))
            || ((isTenBit(a) ? 1 : 0) - (isTenBit(b) ? 1 : 0))
            || (MP4.test(a.mimeType || '') ? -1 : 1))[0] || null;

    return best(offered);
}

function readIndex(carry, format) {
    if (WEBM.test((format && format.mimeType) || '')) {
        const index = webm.segmentIndex(carry, format.contentLength, format);
        return index && { init: index.init, segments: index.segments };
    }

    const sidx = mp4.boxes(carry).filter((box) => box.type === 'sidx')[0];
    if (!sidx) return null;

    const index = mp4.segmentIndex(carry);
    if (!index) return null;

    return { init: { start: 0, end: sidx.end - 1 }, segments: index.segments };
}

// What the stream has to be told it already holds to continue from a segment rather than
// from the beginning. The library offers no position except this resume state, whose
// segment durations the file's own index supplies exactly.
function stateFor(track, records, number, durationMs) {
    const before = (track.index || []).filter((segment) => segment.number < number);
    if (!before.length || records.size < 2) return null;

    const headers = before.map((segment) => ({
        sequenceNumber: segment.number,
        durationMs: String(segment.durationMs),
        startMs: String(segment.startMs),
        timeRange: {
            timescale: 1000,
            startTicks: String(segment.startMs),
            durationTicks: String(segment.durationMs)
        }
    }));

    const mine = `${track.format.itag}:${track.format.xtags || ''}`;

    return {
        durationMs,
        requestNumber: 0,
        playerTimeMs: headers.reduce((total, header) => total + Number(header.durationMs), 0),
        activeSabrContexts: [],
        sabrContextUpdates: [],
        cachedBufferedRanges: [],
        initializedFormats: [...records.entries()].map(([key, metadata]) => ({
            formatKey: key,
            formatInitializationMetadata: metadata,
            downloadedSegments: key === mine
                ? headers.map((header) => [Number(header.sequenceNumber), {
                    formatIdKey: key,
                    segmentNumber: Number(header.sequenceNumber),
                    durationMs: header.durationMs,
                    mediaHeader: header,
                    bufferedChunks: []
                }])
                : [],
            lastMediaHeaders: key === mine ? headers : []
        }))
    };
}

async function fill(track, params, chosen, using) {
    const gate = () => new Promise((go) => {
        const look = () => {
            if (track.stopped || track.restartAt || !track.satisfied) return go();
            setTimeout(look, 250);
        };
        look();
    });

    const follow = (using && using.follow) || sabr.follow;
    const records = params.records || new Map();

    for (;;) {
        const from = track.restartAt || 0;
        track.restartAt = null;

        await run(from);

        if (track.stopped || track.failure) break;

        // Reaching the end is not the end of the work: what was fetched is deleted as the viewer
        // passes it, so seeking back asks for parts that are no longer here.
        if (!track.restartAt) await asked(track);
        if (track.stopped || track.failure) break;
    }

    if (!track.index) track.broke(new Error(`${track.kind} arrived without a segment index`));

    async function run(from) {
        const at = (track.index || []).filter((segment) => segment.number === from)[0];

        // The first segment needs no state: a stream given no position starts there anyway, and
        // asking for one that cannot be built leaves the start unfetchable.
        const first = track.index ? track.index[0].number : 1;
        const positioned = Boolean(from && from > first);
        const state = positioned ? stateFor(track, records, from, Number(params.durationMs)) : null;

        // Naming a position takes both formats, and the other track may not have reported its
        // own yet. Retried rather than abandoned, which would leave the player waiting for a
        // segment nothing will now fetch; bounded, so a seek cannot hang in silence.
        if (positioned && !state) {
            track.positioning = (track.positioning || 0) + 1;

            if (track.positioning > POSITION_TRIES) {
                track.positioning = 0;
                return track.broke(new Error(`${track.kind} could not be positioned at segment ${from}`));
            }

            if (track.positioning === 1) {
                journal.service('seek', `${track.kind} waiting to name segment ${from}`);
            }

            await new Promise((again) => setTimeout(again, 250));
            track.restartAt = from;
            return undefined;
        }

        track.positioning = 0;

        journal.service('run', `${track.kind} ${track.format.itag} from ${from || 'the start'}`
            + `${positioned ? ` claiming ${(state.initializedFormats.find((one) => one.downloadedSegments.length) || { downloadedSegments: [] }).downloadedSegments.length} segments` : ''}`);

        track.running = true;

        const following = await follow(Object.assign({}, params, { gate }), {
            kind: track.kind,
            videoFormat: chosen.video,
            audioFormat: chosen.audio,
            state,
            onFormat: (key, metadata) => records.set(key, metadata)
        });

        track.abort = following.abort;

        // Kept as the pieces they arrived in: joining on every chunk would copy a whole 4K
        // segment hundreds of times.
        let parts = [];
        let held = 0;
        let base = at ? at.start : 0;

        track.next = from || 0;
        track.from = from || 0;

        let skipping = Boolean(from);

        const take = (upTo) => {
            const joined = Buffer.concat(parts, held);
            const wanted = joined.subarray(0, upTo);

            parts = joined.length > upTo ? [joined.subarray(upTo)] : [];
            held = joined.length - wanted.length;

            return wanted;
        };

        // Whether a stream beginning partway through has re-sent the file's header, which is
        // already on disk and would put every segment after it at the wrong offset.
        const resent = () => {
            const head = Buffer.concat(parts, held);

            if (WEBM.test(track.format.mimeType || '')) {
                if (head.length < 4) return null;
                return head.readUInt32BE(0) === 0x1a45dfa3;
            }

            const boxes = mp4.boxes(head);
            if (!boxes.length) return null;
            return boxes[0].type === 'ftyp';
        };

        const cut = async () => {
            while (track.index) {
                if (skipping) {
                    const again = resent();

                    if (again === null) return;
                    if (!again) { skipping = false; continue; }

                    const header = track.init.end + 1;
                    if (held < header) return;

                    take(header);
                    skipping = false;
                    continue;
                }

                const segment = track.next === 0
                    ? track.init
                    : track.index.filter((entry) => entry.number === track.next)[0];

                if (!segment || segment.end - base >= held) return;

                if (segment.start !== base) {
                    throw new Error(`${track.kind} segment ${track.next} starts at ${segment.start} but the stream is at ${base}`);
                }

                await writeFile(track.file(track.next), take(segment.end - base + 1));
                track.arrived(track.next);

                if (track.next === from || track.next === (track.index[0] || {}).number) {
                    journal.service('run', `${track.kind} ${track.format.itag} wrote segment ${track.next}`);
                }

                base = segment.end + 1;
                track.next = track.next === 0 ? track.index[0].number : track.next + 1;

                await track.forgetBehind();
            }
        };

        const began = Date.now();
        let arrived = 0;
        let announced = false;

        try {
            for (;;) {
                const { done, value } = await following.reader.read();
                if (done || track.stopped || track.restartAt) {
                    journal.service('run', `${track.kind} ${track.format.itag} from ${from || 0} ended`
                        + ` after ${arrived} bytes${done ? ', server closed' : ''}`
                        + `${track.restartAt ? `, moving to ${track.restartAt}` : ''}`);
                    break;
                }

                parts.push(Buffer.from(value));
                held += value.byteLength;
                arrived += value.byteLength;

                if (!announced) {
                    announced = true;
                    journal.service('run', `${track.kind} ${track.format.itag} from ${from || 0}`
                        + ` first bytes after ${Date.now() - began}ms`);
                }

                if (!track.index) {
                    const read = readIndex(Buffer.concat(parts, held).subarray(0, HEAD_BYTES), track.format);
                    if (read) {
                        track.init = read.init;
                        track.index = read.segments;
                    } else if (held >= HEAD_BYTES) {
                        throw new Error(`${track.kind} has no segment index in its first ${HEAD_BYTES} bytes`);
                    }
                }

                if (track.index) await cut();
            }
        } catch (error) {
            if (!track.stopped && !track.restartAt) track.broke(error);
        }

        track.running = false;

        if (track.abort) {
            try { track.abort(); } catch (e) {}
        }

        // SABR hands over a portion at a time and expects to be asked again, so a close short of
        // the last segment is an ordinary end rather than a finished download.
        if (!track.stopped && !track.restartAt && !track.failure && track.index) {
            const last = track.index[track.index.length - 1].number;
            if (track.next <= last) track.restartAt = track.next;
        }
    }
}

function asked(track) {
    return new Promise((resolve) => {
        const look = () => {
            if (track.stopped || track.failure || track.restartAt) return resolve();
            setTimeout(look, 250);
        };

        look();
    });
}

function indexed(track) {
    return new Promise((resolve, reject) => {
        const started = Date.now();

        const look = () => {
            if (track.index) return resolve(track);
            if (track.failure) return reject(track.failure);
            if (Date.now() - started > INDEX_WAIT) {
                return reject(new Error(`${track.kind} never sent its segment index`));
            }
            setTimeout(look, 50);
        };

        look();
    });
}

const span = (index) => index[index.length - 1].startMs + index[index.length - 1].durationMs;

async function open(params) {
    if (!Array.isArray(params.formats) || !params.formats.length) throw new Error('no formats');

    // `fresh` means the viewer changed something, so only a request made after the last
    // session will name the new choice; on an ordinary open no such request is coming.
    const since = params.fresh ? [...sessions.values()]
        .filter((one) => one.videoId === params.videoId && one.ready)
        .reduce((latest, one) => Math.max(latest, one.at), 0) : 0;

    const taken = await sabr.awaitSession(params.ustreamerConfig, null, since || undefined);

    const chosen = {
        video: pick(params.formats, 'video', params.maxHeight, null, undefined, params.hdr),
        audio: pick(params.formats, 'audio', null, taken.selected, params.audioXtags)
    };

    if (!chosen.video) throw new Error('this response offers no MP4 video track');
    if (!chosen.audio) throw new Error('this response offers no MP4 audio track');

    // Unique per stream, not per video: a quality change opens another for the same video,
    // and the one being replaced stays servable until the page has moved across.
    const id = [params.videoId || 'video', chosen.video.itag, Date.now().toString(36)].join('-');

    const tracks = {};

    for (const kind of ['video', 'audio']) {
        const dir = join(MEDIA_DIR, id, kind);
        await mkdir(dir, { recursive: true });
        tracks[kind] = new Track(kind, chosen[kind], dir);
    }

    const session = {
        id,
        videoId: params.videoId || null,
        tracks,
        chosen,
        ready: false,
        at: Date.now(),
        read: Date.now()
    };

    sessions.set(id, session);

    // Shared, because a stream learns only about the track it carries and naming a position
    // takes both.
    const taking = Object.assign({}, params, { session: taken, records: new Map() });

    // Not awaited: the download runs for as long as the video does.
    Object.values(tracks).forEach((track) => {
        fill(track, taking, chosen).catch((error) => track.broke(error));
    });

    try {
        await Promise.all(Object.values(tracks).map(indexed));
    } catch (failure) {
        await close(id);
        throw failure;
    }

    session.durationMs = Math.min(span(tracks.video.index), span(tracks.audio.index));
    session.ready = true;

    // While the element is still fetching the manifest, so a resumed video is already being
    // fetched from the right place by the time it asks and does not pay a second restart.
    beginAt(session, Number(params.startMs) || 0);

    journal.service('open', `${id}: video ${chosen.video.itag} ${chosen.video.height}p, `
        + `audio ${chosen.audio.itag} xtags ${JSON.stringify(chosen.audio.xtags || '')}, `
        + `${tracks.video.index.length} segments, ${Math.round(session.durationMs / 1000)}s`);

    return session;
}

function busy() {
    const now = Date.now();
    return [...sessions.values()].some((session) => session.ready && now - session.read < 15000);
}

function align(session, kind, number) {
    const moved = session.tracks[kind];
    const other = session.tracks[kind === 'video' ? 'audio' : 'video'];
    if (!moved || !other || !moved.index || !other.index) return;

    const at = moved.index.filter((segment) => segment.number === number)[0];
    if (!at) return;

    const match = other.index.filter((segment) => segment.startMs + segment.durationMs > at.startMs)[0];
    if (!match) return;

    other.want(match.number);

    if (other.have.has(match.number) || other.reachable(match.number)) return;

    other.seekTo(match.number);
}

function beginAt(session, startMs) {
    if (!startMs || startMs <= 0) return;

    Object.keys(session.tracks).forEach((kind) => {
        const track = session.tracks[kind];
        if (!track.index) return;

        const holding = track.index.filter((segment) => segment.startMs + segment.durationMs > startMs)[0];
        if (!holding) return;

        // A little before the moment: the element asks for a segment or two behind where it means
        // to start, and landing exactly on it throws the positioned stream away.
        const first = track.index[0].number;
        const wanted = Math.max(first, holding.number - LEAD_IN);
        const at = track.index.filter((segment) => segment.number === wanted)[0];

        if (!at || at.number === first) return;

        // So read-ahead is measured from here rather than from the start of the video, which
        // would have the download stop before reaching it.
        track.want(at.number);
        track.seekTo(at.number);
    });
}

function locate(track, number) {
    if (number === 0) return track.init;
    return (track.index || []).filter((segment) => segment.number === number)[0] || null;
}

function awaitVideo(videoId, timeout) {
    const deadline = Date.now() + (timeout || SEGMENT_WAIT);

    return new Promise((resolve, reject) => {
        const look = () => {
            // Ready, not merely present: a session exists from the moment it is asked for, and its
            // manifest cannot be written until both indexes have been read.
            const found = [...sessions.values()]
                .filter((session) => session.videoId === videoId && session.ready);

            if (found.length) return resolve(found[found.length - 1]);

            if (Date.now() > deadline) return reject(new Error(`no session for ${videoId}`));
            setTimeout(look, 50);
        };

        look();
    });
}

function sweep() {
    const now = Date.now();

    return Promise.all([...sessions.values()]
        .filter((session) => now - session.read > IDLE_TIMEOUT)
        .map((session) => {
            console.log(`[stream] ${session.id} unread for ${Math.round((now - session.read) / 1000)}s; dropping it`);
            return close(session.id);
        }));
}

async function close(id) {
    const session = sessions.get(id);
    if (!session) return false;

    sessions.delete(id);

    for (const track of Object.values(session.tracks)) {
        track.stopped = true;
        if (track.abort) {
            try { track.abort(); } catch (e) {}
        }
    }

    await rm(join(MEDIA_DIR, id), { recursive: true, force: true }).catch(() => {});
    return true;
}

async function clean() {
    await rm(MEDIA_DIR, { recursive: true, force: true }).catch(() => {});
    await mkdir(MEDIA_DIR, { recursive: true }).catch(() => {});
}

module.exports = {
    HEAD_BYTES, IDLE_TIMEOUT, KEEP_BEHIND, MEDIA_DIR, READ_AHEAD, READ_AHEAD_AT_FIRST,
    SEGMENT_WAIT, SWEEP_INTERVAL, Track,
    align, awaitVideo, busy, clean, close, fill, indexed, locate, open, pick, sessions, span, stateFor, sweep
};
