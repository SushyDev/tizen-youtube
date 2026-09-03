'use strict';

// Fetches a video's media over SABR a segment at a time, keeping only what is near the
// playhead, so a twelve-hour video costs the same disk as a three-minute one. The segment
// index in YouTube's initialization segment describes the whole file before any of it has
// been fetched, which is what the manifest and the cutting are both built on.

const { mkdir, rm, writeFile } = require('fs/promises');
const { join } = require('path');

const journal = require('./journal.js');
const mp4 = require('./mp4.js');
const webm = require('./webm.js');
const sabr = require('./sabr.js');

// On a TV this is the app's own data directory. Media is large and never leaves it.
const MEDIA_DIR = process.env.TUBE_MEDIA_DIR || '/home/owner/share/tube/media';

// A segment the player asks for that has not arrived is waited for, not refused: the
// download runs faster than playback, so this is a stall rather than a failure.
const SEGMENT_WAIT = 30000;

// The index sits at the front of the file, so it arrives with the first bytes or the
// stream is not one this can serve. Waiting the full segment timeout on that only keeps
// the viewer in front of nothing for half a minute before the page takes the picture back.
const INDEX_WAIT = 10000;

// How far ahead of what the player has asked for the download may get. Roughly a minute of
// media: enough that a slow patch is not felt, small enough that the set is not writing
// hundreds of megabytes while it decodes 2160p60.
const READ_AHEAD = 10;

// Budgeting that window in bytes rather than segments was tried, at forty-eight megabytes,
// so that ten segments of 2160p60 HDR could not put a hundred and fifty on the disk. It
// stops the download partway through a file the plain-file path is serving in one
// response: a sixty-three megabyte video hesitated hard at about thirty-nine seconds, which
// is where forty-eight megabytes of it falls, and repeated retries left playback at zero.
//
// The count alone, then, until the window can be bounded without starving a reader that is
// already past it.

// What it is allowed to get ahead by at the very beginning. Without this the download runs
// flat out for the first ten seconds — saturating the link and writing several megabytes a
// second — which is exactly when the decoder is starting on 2160p60 and when frames get
// dropped. It opens up as playback settles.
const READ_AHEAD_AT_FIRST = 8;

// Holding the manifest back until a few segments were on disk was tried, to give the
// decoder something to start against. It made the wait before the picture longer and
// changed nothing about the frames lost, because what is actually short is throughput
// rather than the head start.

// Segments this far behind the player are deleted.
//
// Three was too few, and the cost of being wrong is not what it looks like. A player does
// not only move forwards: it asks for a segment again after a stall, or after its own
// buffer is evicted, and one that has been deleted cannot be handed over — so the download
// is sent backwards to fetch it, throwing away everything it had read ahead. Caught on the
// television: the download stood at segment 14 holding twelve, the element asked for
// segment 1, and the whole read-ahead went. Then it stalled, and asked again, and so on.
//
// Fifteen is enough that a player which has fallen a little behind is answered from what is
// already here. It is bounded, and a stream nobody is reading is dropped whole soon after.
const KEEP_BEHIND = 15;

// How long to keep trying to name a position before saying it cannot be done. Each try is
// a quarter of a second, so this is a few seconds — long enough for the other track to
// report its format, short enough that a viewer is told rather than left waiting.
const POSITION_TRIES = 40;

// How many segments before a resume position to begin at, so the element's own first
// request is already being fetched rather than costing a second restart.
const LEAD_IN = 2;

// Nothing has asked this session for a segment in this long, so nobody is watching it.
// How long a stream nobody is reading is kept before it is dropped.
//
// This was five minutes, swept once a minute, which meant closing a video left its
// download alive for up to six — and every video opened in that window stacked another.
// At 2160p60 each one is tens of megabits a second of media nobody will ever see, and
// together they starved the picture that was actually playing, and the thumbnails, and
// the proxy itself.
//
// Short enough that leaving a video frees the line almost at once; long enough to survive
// the gap while the player restarts one for a quality or audio change.
const IDLE_TIMEOUT = 45 * 1000;
const SWEEP_INTERVAL = 15 * 1000;

// The initialization segment is ftyp, moov and sidx together, and until all three have
// arrived there is nothing to parse.
const HEAD_BYTES = 128 * 1024;

// A container the platform's own decoder path opens from a plain URL. Everything else in
// the response is WebM, which it does not.
const MP4 = /^(video|audio)\/mp4/;
const WEBM = /^(video|audio)\/webm/;

/**
 * Whether a format describes itself before it is fetched.
 *
 * YouTube also offers the same video transcoded as it is served — no `initRange`, no
 * `indexRange`, and no `sidx` in what arrives. Everything here is built on that index:
 * it is what says how many segments there are and where each one starts, so a manifest
 * covering the whole video can be written before a byte of media has been fetched.
 * Without it there is nothing to serve.
 */
const preIndexed = (format) => format.type !== 'FORMAT_STREAM_TYPE_OTF';

/**
 * Whether a format carries a wider colour space than ordinary video.
 *
 * The response says so outright, in the primaries and the transfer curve — BT.2020 with
 * either of the two HDR curves. A ten-bit encode of BT.709 material is not this.
 */
function isHdr(format) {
    const colour = format.colorInfo || {};
    if (colour.primaries !== 'COLOR_PRIMARIES_BT2020') return false;

    return colour.transferCharacteristics === 'COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084'
        || colour.transferCharacteristics === 'COLOR_TRANSFER_CHARACTERISTICS_ARIB_STD_B67';
}

/**
 * Whether a format is ten bits deep.
 *
 * AV1 and the long form of VP9 both put the depth in the fourth field of the codec string —
 * `av01.0.13M.10` against `av01.0.12M.08`, `vp09.00.51.08` against `vp09.02.51.10`. VP9's
 * short form names only its profile, and profile 2 is the ten-bit one. Anything that does
 * not say is taken as eight, which is what everything else in the ladder is.
 */
function isTenBit(format) {
    const codec = (/codecs="([^"]+)"/.exec(format.mimeType || '') || [])[1] || '';

    if (codec.indexOf('av01.') === 0 || codec.indexOf('vp09.') === 0) {
        const depth = codec.split('.')[3];
        return depth === '10' || depth === '12';
    }

    return /^vp9\.(2|3)$/.test(codec);
}

const sessions = new Map();

/** One track being fetched, a segment at a time. */
class Track {
    constructor(kind, format, dir) {
        this.kind = kind;
        this.format = format;
        this.dir = dir;

        this.index = null;       // every segment in the file, from the segment index
        this.have = new Set();   // segment numbers currently on disk
        this.waiting = new Map();

        this.running = false;    // whether a stream is fetching for this track right now
        this.wanted = 0;         // the furthest segment the player has asked for
        this.next = 0;           // the segment being cut out of the stream
        this.from = 0;           // where the stream running now began
        this.restartAt = null;   // where the download is to begin again
        this.stopped = false;
        this.failure = null;
    }

    /**
     * Asks the download to begin again at a segment. Playback starts wherever it was left
     * off and can be sent anywhere by a seek, while a stream only ever runs forwards from
     * where it began — so the only way to serve a segment it has passed, or one far beyond
     * it, is to start another one there.
     */
    seekTo(number) {
        if (this.restartAt === number) return;

        journal.service('seek', `${this.kind} to segment ${number} (at ${this.next}, holds ${this.have.size})`);
        this.restartAt = number;
        if (this.abort) {
            try { this.abort(); } catch (e) { /* already stopped */ }
        }
    }

    /**
     * Whether a segment will arrive on its own before long, or needs the stream moved.
     *
     * Being within read-ahead of where the download stands is not enough on its own: it has
     * to be *fetching*. A stream that has ended, or is parked waiting to be told where to
     * go, will never reach anything however close it is — and answering "it is coming"
     * about a segment nobody is fetching is how a seek turned into a thirty-second wait and
     * then a refusal, with nothing in the journal because no restart was ever asked for.
     */
    reachable(number) {
        if (!this.running) return false;

        return number >= this.next && number <= this.next + READ_AHEAD;
    }

    file(number) {
        return join(this.dir, number === 0 ? 'init.mp4' : `${number}.m4s`);
    }

    /** Resolves once a segment is on disk, fetching it from elsewhere in the file if need be. */
    reach(number) {
        if (this.have.has(number)) return Promise.resolve();
        if (this.failure) return Promise.reject(this.failure);

        // Nothing is fetching this any more, so waiting the full segment timeout only
        // delays the answer. The element asking is one the page has moved on from, and it
        // is better told at once than left holding the request for half a minute.
        if (this.stopped) return Promise.reject(new Error(`${this.kind} is no longer being fetched`));

        // Behind the stream, or so far ahead that waiting for it to arrive in order would
        // be a stall rather than a wait.
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

    /** Nothing more is coming; everyone still waiting is told rather than left to time out. */
    broke(error) {
        journal.service('broke', `${this.kind}: ${error.message}`);
        this.failure = error;

        this.waiting.forEach((waiters) => waiters.forEach((waiter) => {
            clearTimeout(waiter.timer);
            waiter.reject(error);
        }));
        this.waiting.clear();
    }

    /**
     * Where the player has reached, which decides what is fetched next and what is dropped.
     * It follows the player rather than only rising: a seek backwards moves it back, and a
     * mark that only went up would have everything ahead of the old position deleted as
     * fast as it was written.
     */
    want(number) {
        this.wanted = number;
    }

    /**
     * Where read-ahead is measured from: the player's position, or the point the stream was
     * started at while the player has yet to ask for anything.
     *
     * Without the second, a stream that begins partway through a video looks like it is
     * already far ahead of a player sitting at zero, and stops before it has fetched the
     * segment that player is waiting for.
     */
    get behind() {
        return Math.max(this.wanted, this.from ? this.from - 1 : 0);
    }

    /** Whether the download is far enough ahead to stop for a while. */
    get satisfied() {
        // Measured from where the download has reached, not from the highest segment ever
        // held: after a seek backwards the old high numbers are still on disk and would say
        // the download is far ahead of a player that has gone back behind it.
        const allowed = Math.min(READ_AHEAD, READ_AHEAD_AT_FIRST + this.behind);
        return this.next - this.behind >= allowed;
    }

    /**
     * Keeps a window around the player and drops the rest. Behind it is what has been
     * watched; beyond it is what a seek left stranded, downloaded for a position the player
     * has since moved away from. The initialization segment always stays.
     */
    forgetBehind() {
        const oldest = this.wanted - KEEP_BEHIND;

        const gone = [...this.have].filter((number) =>
            number > 0 && (number < oldest || number > this.next));

        gone.forEach((number) => this.have.delete(number));

        return Promise.all(gone.map((number) => rm(this.file(number), { force: true })
            .catch(() => { /* already gone */ })));
    }
}

/**
 * The MP4 track to fetch: the tallest picture at or below a ceiling, and for sound whatever
 * the page's own player chose.
 *
 * Sound is not ours to choose. The same itag appears more than once — a dubbed track, or
 * the same audio with its dynamic range compressed — and which one the viewer is meant to
 * hear was decided by YouTube, not by which has the higher bitrate.
 */
function pick(formats, kind, maxHeight, chosen, xtags, hdr) {
    // Picture may be WebM; sound stays MP4. At 2160p60 the MP4 ladder offers only ten-bit
    // AV1, which this hardware cannot hold, while its VP9 path plays that size without
    // dropping a frame — and VP9 is never offered in anything but WebM.
    const container = kind === 'video'
        ? (format) => MP4.test(format.mimeType || '') || WEBM.test(format.mimeType || '')
        : (format) => MP4.test(format.mimeType || '');

    const wanted = formats
        .filter(container)
        .filter(preIndexed)
        .filter((format) => (kind === 'video' ? !!format.height : !format.height));

    // Sound is never ours to choose. The player says which track it is playing — the
    // language, and whether the dynamic range is compressed — and `xtags` names it exactly.
    // An empty one is the default track, so "not told" and "the default" are different
    // answers and cannot share a test.
    if (kind === 'audio') {
        if (typeof xtags === 'string') {
            const said = wanted.filter((format) => (format.xtags || '') === xtags);
            if (said.length) return said[0];
        }

        // Falling back on what the player last asked the servers for, then on the best.
        const asChosen = wanted.filter((format) => (chosen || []).some((one) =>
            one.itag === format.itag && (one.xtags || '') === (format.xtags || '')));

        return asChosen[0] || wanted.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0] || null;
    }

    // Picture is chosen by a ceiling, never by what the player last asked for. Before it has
    // buffered anything it asks for a low rung and works upwards, so following that would
    // take a viewer who chose 2160p straight back down.
    //
    // Depth before height, above thirty frames a second. This set decodes 2160p60 in eight
    // bits without dropping a frame and stalls for seconds on the same rung in ten — and
    // some videos offer only ten-bit AV1 at the top, so taking the tallest picture on
    // offer is how a video that would have played perfectly at 1440p hangs at 2160p.
    const offered = wanted.filter((format) => !maxHeight || format.height <= maxHeight);

    // Equal pictures are ordered by container only to be predictable: MP4 is what the rest
    // of this was written against, so it wins a tie and WebM is taken when it offers
    // something MP4 does not.
    // Tallest, then fastest, then the wider colour where the video actually has one.
    //
    // Colour rather than bit depth, because they are not the same question. Ten bits on a
    // video graded for BT.709 is a bigger file of the same picture; ten bits on one graded
    // for BT.2020 is the HDR master. Where neither is HDR the eight-bit encode wins, which
    // is what the set's own app plays on an SDR video at this size.
    const best = (formats) => formats
        .sort((a, b) => (b.height - a.height)
            || ((b.fps || 30) - (a.fps || 30))
            || (hdr ? (isHdr(b) ? 1 : 0) - (isHdr(a) ? 1 : 0) : (isHdr(a) ? 1 : 0) - (isHdr(b) ? 1 : 0))
            || ((isTenBit(a) ? 1 : 0) - (isTenBit(b) ? 1 : 0))
            || (MP4.test(a.mimeType || '') ? -1 : 1))[0] || null;

    // Ten-bit AV1 at 2160p60 was refused here for a while, on a measurement that showed it
    // stalling for seconds and dropping throughout. That measurement was taken on a resumed
    // video, and seeking was broken for the container it was being compared against — with
    // that fixed it holds 2160p60 without dropping a frame, and it is the only picture that
    // puts this panel into HDR. VP9 profile 2 decodes but the set stays in standard range.
    return best(offered);
}

/**
 * Reads the file's own segment index, once enough of the head has arrived to hold it.
 *
 * MP4 carries a `sidx` that says how long each segment runs and how many bytes it takes;
 * WebM carries cues that say where each cluster begins, and the file's own length is what
 * closes the last one. Both come back in the same shape, so nothing downstream has to know
 * which container it is serving.
 */
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

/**
 * What the stream has to be told it already holds for the server to continue from a given
 * segment rather than from the beginning.
 *
 * The library only offers a position through a state meant for restoring an interrupted
 * download, and its loop works the position out from the durations of the segments that
 * state says are already there. The file's own index supplies them exactly, which is what
 * makes the claim agree with the server's own idea of the same file.
 */
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

/**
 * Fills a track, cutting what SABR delivers back into the segments the file's index says it
 * is made of. Only what has not been played and not yet been reached is on disk.
 */
async function fill(track, params, chosen, using) {
    // Holds the download between requests. The stream reads one request fully before asking
    // for the next, so waiting here is where read-ahead is decided.
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

        // Reaching the end of the file is not the end of the work. What was fetched is
        // deleted as the viewer passes it, so watching the same video again — or seeking
        // back into it — asks for parts of the file that are no longer here, and there has
        // to be something left running to go and get them.
        if (!track.restartAt) await asked(track);
        if (track.stopped || track.failure) break;
    }

    if (!track.index) track.broke(new Error(`${track.kind} arrived without a segment index`));

    /** One stream, from the beginning or from a segment, until it ends or is moved. */
    async function run(from) {
        const at = (track.index || []).filter((segment) => segment.number === from)[0];

        // The first segment needs no state: there is nothing before it to claim, and a
        // stream with no position given starts there anyway. Asking for one and finding it
        // impossible to build is how seeking back to the start used to give up and leave
        // the beginning of the video permanently unfetchable.
        const first = track.index ? track.index[0].number : 1;
        const positioned = Boolean(from && from > first);
        const state = positioned ? stateFor(track, records, from, Number(params.durationMs)) : null;

        // Naming a position takes both formats, and the other track may not have said what
        // it is yet. Asked again in a moment rather than given up on: abandoning the seek
        // leaves the player waiting for a segment that will now never be fetched.
        if (positioned && !state) {
            // Both tracks have to have said what format they are before a position can be
            // named, and the other one may not have got there yet. Asked again in a moment
            // rather than given up on — but not for ever: this used to retry silently and
            // without limit, which from the sofa is a seek that loads and never arrives,
            // and in the journal is nothing at all.
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

        // Bytes that have arrived but do not yet complete a segment, kept as the pieces they
        // arrived in. Joining on every chunk would copy a whole 4K segment hundreds of times.
        let parts = [];
        let held = 0;
        let base = at ? at.start : 0;

        track.next = from || 0;
        track.from = from || 0;

        // A stream that begins partway through still opens with the file's header. It is
        // already on disk, and taking it for media would put every segment after it at the
        // wrong offset.
        let skipping = Boolean(from);

        const take = (upTo) => {
            const joined = Buffer.concat(parts, held);
            const wanted = joined.subarray(0, upTo);

            parts = joined.length > upTo ? [joined.subarray(upTo)] : [];
            held = joined.length - wanted.length;

            return wanted;
        };

        // Whether a stream that begins partway through has opened with the file's header
        // again. It is already on disk, and taking it for media puts every segment after it
        // at the wrong offset.
        //
        // This used to read MP4 boxes whatever the container was. Fed WebM it took the EBML
        // header's first four bytes for a box length, got a number larger than the buffer,
        // found no boxes and gave up — so a seek into a WebM stream downloaded for ever and
        // never cut a single segment. Which is every part-watched video on VP9.
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

                    // Not enough bytes yet to tell one from the other.
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

                // Either past the end of the file, or the segment is not all here yet.
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

        // DEV: a run that produces nothing looks exactly like a run that was never asked
        // for, and the difference is the whole question when a seek goes quiet.
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
                    // Bounded rather than conditional: a first chunk larger than this would
                    // mean the index is never looked for, and an unbounded search would
                    // re-join a growing buffer on every chunk of a stream that has none.
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
            try { track.abort(); } catch (e) { /* already stopped */ }
        }

        // The server closed while there is still video left to fetch, and nobody asked it
        // to stop. SABR hands over a portion at a time and expects to be asked again, so
        // this is an ordinary end and not a finished download — but nothing was waiting to
        // notice: a segment inside the read-ahead window counts as arriving on its own, so
        // the element waited for one that nothing was fetching any more.
        //
        // Measured on the television: the stream closed after two hundred and five
        // megabytes of a nine-hundred-megabyte video, and playback froze at 15.38 seconds
        // with the buffer holding three and a half and the service perfectly idle.
        if (!track.stopped && !track.restartAt && !track.failure && track.index) {
            const last = track.index[track.index.length - 1].number;
            if (track.next <= last) track.restartAt = track.next;
        }
    }
}

/** Waits until something asks this track to fetch from somewhere, or it is shut down. */
function asked(track) {
    return new Promise((resolve) => {
        const look = () => {
            if (track.stopped || track.failure || track.restartAt) return resolve();
            setTimeout(look, 250);
        };

        look();
    });
}

/** Waits for a track to have read its own index, which is all playback needs to start. */
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

/**
 * Starts both tracks and waits only for their indexes — a few kilobytes each — so playback
 * can begin against a manifest that already describes the whole video.
 */
async function open(params) {
    if (!Array.isArray(params.formats) || !params.formats.length) throw new Error('no formats');

    // The page's own request is where the streaming url and the PO token come from, and it
    // has not necessarily been made yet. Held onto rather than looked up again per track:
    // the page goes on making requests for other videos while this one opens.
    //
    // `fresh` is set only when the viewer changed something: what they chose is in the
    // request the player has yet to make, and the one before it names the old choice and
    // would match just as well. Waiting for a new one on an ordinary open would mean
    // waiting for a request the player has no reason to send.
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

    // Unique per stream rather than per video: changing quality or audio track opens
    // another one for the same video, and the one being replaced has to stay servable until
    // the page has moved across to its successor.
    const id = [params.videoId || 'video', chosen.video.itag, Date.now().toString(36)].join('-');

    const tracks = {};

    for (const kind of ['video', 'audio']) {
        const dir = join(MEDIA_DIR, id, kind);
        await mkdir(dir, { recursive: true });
        tracks[kind] = new Track(kind, chosen[kind], dir);
    }

    // Registered before it can be served: the page is already waiting on a URL for this
    // video, and `ready` is what tells that wait when there is something behind it.
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

    // Shared: a stream that carries one track only learns about that one, and naming a
    // position takes both.
    const taking = Object.assign({}, params, { session: taken, records: new Map() });

    // Deliberately not awaited: the download runs for as long as the video does.
    Object.values(tracks).forEach((track) => {
        fill(track, taking, chosen).catch((error) => track.broke(error));
    });

    try {
        await Promise.all(Object.values(tracks).map(indexed));
    } catch (failure) {
        // Registered but never usable: without this it goes on downloading, and nothing
        // will ever ask it for a segment or close it.
        await close(id);
        throw failure;
    }

    session.durationMs = Math.min(span(tracks.video.index), span(tracks.audio.index));
    session.ready = true;

    // A part-watched video begins where it was left, and the element is told so in the
    // address' fragment — which no server ever sees. Left to itself the download runs from
    // the beginning while the element asks for a segment minutes in, and serving that means
    // abandoning this download and starting another one there. At 2160p60 that cost ten
    // seconds from the ask to the bytes, and the television's player gives up well before
    // then: every part-watched video fell back to the default player.
    //
    // Moved here instead, while the element is still fetching and parsing the manifest, so
    // the restart is already under way by the time it asks. Not before the indexes are
    // read: naming a position takes a segment index to name it in.
    beginAt(session, Number(params.startMs) || 0);

    journal.service('open', `${id}: video ${chosen.video.itag} ${chosen.video.height}p, `
        + `audio ${chosen.audio.itag} xtags ${JSON.stringify(chosen.audio.xtags || '')}, `
        + `${tracks.video.index.length} segments, ${Math.round(session.durationMs / 1000)}s`);

    return session;
}

/**
 * Whether this app is serving a picture at the moment.
 *
 * `read` is stamped every time a segment is asked for, so a session the player is actually
 * pulling from is recent and one it has moved on from is not.
 */
function busy() {
    const now = Date.now();
    return [...sessions.values()].some((session) => session.ready && now - session.read < 15000);
}

/**
 * Brings the other track to the same moment.
 *
 * The player asks for one segment at a time, so a resumed video moves the picture to where
 * it left off and says nothing about the sound — which then grinds forward from the start
 * while the player waits for audio it will not have for minutes. Both tracks belong to one
 * position, and only this knows about both of them.
 */
function align(session, kind, number) {
    const moved = session.tracks[kind];
    const other = session.tracks[kind === 'video' ? 'audio' : 'video'];
    if (!moved || !other || !moved.index || !other.index) return;

    const at = moved.index.filter((segment) => segment.number === number)[0];
    if (!at) return;

    // The segment holding that moment: the first whose end is past where the other track
    // has been moved to.
    const match = other.index.filter((segment) => segment.startMs + segment.durationMs > at.startMs)[0];
    if (!match) return;

    other.want(match.number);

    if (other.have.has(match.number) || other.reachable(match.number)) return;

    other.seekTo(match.number);
}

/**
 * Moves both tracks to the segment holding a moment, before anything has asked for one.
 *
 * Nothing is awaited: the restart happens on the download's own loop, and what the element
 * asks for meanwhile is served the same way it always was.
 */
function beginAt(session, startMs) {
    if (!startMs || startMs <= 0) return;

    Object.keys(session.tracks).forEach((kind) => {
        const track = session.tracks[kind];
        if (!track.index) return;

        const holding = track.index.filter((segment) => segment.startMs + segment.durationMs > startMs)[0];
        if (!holding) return;

        // A little before the moment, not exactly on it. The element asks for a segment or
        // two ahead of where it means to start — measured resuming at seventy-nine seconds,
        // this landed on segment sixteen and the element then asked for fourteen, which
        // threw the positioned stream away and paid another restart: 2.3s to first bytes,
        // for nothing. Starting earlier costs a couple of segments already fetched, which
        // is what read-ahead is for.
        const first = track.index[0].number;
        const wanted = Math.max(first, holding.number - LEAD_IN);
        const at = track.index.filter((segment) => segment.number === wanted)[0];

        if (!at || at.number === first) return;

        // So read-ahead is measured from where the picture is wanted rather than from the
        // start of the video, which would have the download stop before reaching it.
        track.want(at.number);
        track.seekTo(at.number);
    });
}

/** Everything needed to send one segment, once it is on disk. */
function locate(track, number) {
    if (number === 0) return track.init;
    return (track.index || []).filter((segment) => segment.number === number)[0] || null;
}

/**
 * The session for a video, once there is one. The page asks the player for a URL before it
 * has finished asking us for a session, so the request waits here rather than failing.
 */
function awaitVideo(videoId, timeout) {
    const deadline = Date.now() + (timeout || SEGMENT_WAIT);

    return new Promise((resolve, reject) => {
        const look = () => {
            // Ready, not merely present: a session exists from the moment it is asked for,
            // and its manifest cannot be written until both indexes have been read.
            const found = [...sessions.values()]
                .filter((session) => session.videoId === videoId && session.ready);

            if (found.length) return resolve(found[found.length - 1]);

            if (Date.now() > deadline) return reject(new Error(`no session for ${videoId}`));
            setTimeout(look, 50);
        };

        look();
    });
}

/** Sessions nobody is reading from any more, and the files behind them. */
function sweep() {
    const now = Date.now();

    return Promise.all([...sessions.values()]
        .filter((session) => now - session.read > IDLE_TIMEOUT)
        .map((session) => {
            console.log(`[stream] ${session.id} unread for ${Math.round((now - session.read) / 1000)}s; dropping it`);
            return close(session.id);
        }));
}

/** Stops a session and takes its files with it. */
async function close(id) {
    const session = sessions.get(id);
    if (!session) return false;

    sessions.delete(id);

    for (const track of Object.values(session.tracks)) {
        track.stopped = true;
        if (track.abort) {
            try { track.abort(); } catch (e) { /* already stopped */ }
        }
    }

    await rm(join(MEDIA_DIR, id), { recursive: true, force: true }).catch(() => { /* already gone */ });
    return true;
}

/**
 * Anything left in the media directory outlived the process that was writing it. Nothing
 * refers to it any more, so a restart is where it goes.
 */
async function clean() {
    await rm(MEDIA_DIR, { recursive: true, force: true }).catch(() => { /* not there */ });
    await mkdir(MEDIA_DIR, { recursive: true }).catch(() => { /* made on open */ });
}

module.exports = {
    HEAD_BYTES, IDLE_TIMEOUT, KEEP_BEHIND, MEDIA_DIR, READ_AHEAD, READ_AHEAD_AT_FIRST,
    SEGMENT_WAIT, SWEEP_INTERVAL, Track,
    align, awaitVideo, busy, clean, close, fill, indexed, locate, open, pick, sessions, span, stateFor, sweep
};
