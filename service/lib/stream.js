'use strict';

const { mkdir, rm } = require('fs/promises');
const { Readable } = require('stream');
const { join } = require('path');

const journal = require('./journal.js');
const mp4 = require('./mp4.js');
const webm = require('./webm.js');
const sabr = require('./sabr.js');

const MEDIA_DIR = process.env.TUBE_MEDIA_DIR || '/home/owner/share/tube/media';

const SEGMENT_WAIT = 30000;

// Socket budget: fragments share the page's six-per-origin pool with the proxied youtube.com.
const FRAGMENT_WAIT = 10000;

const FALLBACKS = 3;
const INDEX_WAIT = 10000;

const READ_AHEAD = 10;

const REACH_BYTES = 3 * 1024 * 1024;

const REACH_PATIENCE = 1500;

const POSITION_TRIES = 40;

const LEAD_IN = 2;

const IDLE_TIMEOUT = 45 * 1000;
const SWEEP_INTERVAL = 15 * 1000;
const HEAD_BYTES = 128 * 1024;

const WINDOW_BYTES = Number(process.env.TUBE_WINDOW_BYTES || 12 * 1024 * 1024);

// The platform's player re-asks segments it already read; a dropped one restarts the whole stream.
const TAIL_BYTES = Number(process.env.TUBE_TAIL_BYTES || 16 * 1024 * 1024);

// Past this, Node heap beside the platform's own buffers takes the set down, not just the video.
const HELD_CEILING = 48 * 1024 * 1024;

let heldInMemory = 0;

const holding = () => ({ memory: heldInMemory, disk: 0 });

const MP4 = /^(video|audio)\/mp4/;
const WEBM = /^(video|audio)\/webm/;

const preIndexed = (format) => format.type !== 'FORMAT_STREAM_TYPE_OTF';

function isHdr(format) {
    const colour = format.colorInfo || {};
    if (colour.primaries !== 'COLOR_PRIMARIES_BT2020') return false;

    return colour.transferCharacteristics === 'COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084'
        || colour.transferCharacteristics === 'COLOR_TRANSFER_CHARACTERISTICS_ARIB_STD_B67';
}

// Depth is the 4th codec field; short-form vp9 names only a profile, where 2 and 3 are ten-bit.
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

        this.parts = new Map();
        this.bytesHeld = 0;
        this.readers = new Map();

        this.running = false;
        this.wanted = 0;
        this.next = 0;
        this.from = 0;
        this.restartAt = null;
        this.stopped = false;
        this.failure = null;
        this.fallbacks = 0;
    }

    seekTo(number) {
        if (this.restartAt === number) return;

        journal.service('seek', `${this.kind} to segment ${number} (at ${this.next}, holds ${this.have.size})`);
        this.restartAt = number;

        // Refuse them now: stranded requests hold sockets from the page's pool and block every fetch.
        let passed = 0;

        this.waiting.forEach((waiters, held) => {
            if (held >= number) return;

            waiters.forEach((waiter) => {
                clearTimeout(waiter.timer);
                waiter.reject(new Error(`${this.kind} segment ${held} was passed over`));
            });

            this.waiting.delete(held);
            passed += 1;
        });

        this.readers.forEach((waiters, held) => {
            if (held >= number) return;

            waiters.forEach((reader) => reader.reject(new Error(`${this.kind} segment ${held} was passed over`)));
            this.readers.delete(held);
            passed += 1;
        });

        if (passed) journal.service('seek', `${this.kind} freed ${passed} request(s) left behind`);

        if (this.abort) {
            try { this.abort(); } catch (e) {}
        }
    }

    reachable(number) {
        if (!this.running) return false;

        if (number < this.next || number > this.next + READ_AHEAD) return false;

        if (!this.index) return true;

        const here = this.index.filter((segment) => segment.number === this.next)[0];
        const there = this.index.filter((segment) => segment.number === number)[0];

        if (!here || !there) return true;

        return there.start - here.end <= REACH_BYTES;
    }

    file(number) {
        return join(this.dir, number === 0 ? 'init.mp4' : `${number}.m4s`);
    }

    grow(number, chunk) {
        let part = this.parts.get(number);

        if (!part) {
            part = { chunks: [], length: 0, complete: false };
            this.parts.set(number, part);
        }

        const first = part.length === 0;

        part.chunks.push(chunk);
        part.length += chunk.length;
        this.bytesHeld += chunk.length;
        heldInMemory += chunk.length;

        if (first) this.began(number);
        this.serve(number);
    }

    began(number) {
        (this.waiting.get(number) || []).forEach((waiter) => {
            clearTimeout(waiter.timer);
            waiter.resolve();
        });
        this.waiting.delete(number);
    }

    // WebM bounds are derived from cues, which need only mark "important locations" per spec.
    verify(number) {
        if (number === 0 || this.checked === false) return undefined;

        const part = this.parts.get(number);
        if (!part || part.length < 4) return undefined;

        const head = Track.flatten(part);
        const webm = WEBM.test(this.format.mimeType || '');

        const right = webm
            ? head.readUInt32BE(0) === 0x1f43b675
            : head.length >= 8 && head.toString('latin1', 4, 8) === 'moof';

        if (right) return undefined;

        this.checked = false;

        journal.service('broke', `${this.kind} segment ${number} does not begin with a `
            + `${webm ? 'cluster' : 'moof'}: starts ${head.subarray(0, 8).toString('hex')} — `
            + 'the segment index does not describe this file');

        return undefined;
    }

    settle(number) {
        const part = this.parts.get(number);
        if (part) part.complete = true;

        this.arrived(number);
        this.serve(number);
    }

    serve(number) {
        const part = this.parts.get(number);
        const waiting = this.readers.get(number);
        if (!part || !waiting) return;

        const still = waiting.filter((reader) => {
            if (part.length < reader.upto && !part.complete) return true;
            reader.resolve(part);
            return false;
        });

        if (still.length) this.readers.set(number, still);
        else this.readers.delete(number);
    }

    until(number, upto) {
        const part = this.parts.get(number);
        if (part && (part.length >= upto || part.complete)) return Promise.resolve(part);

        if (this.failure) return Promise.reject(this.failure);
        if (!part && this.stopped) {
            return Promise.reject(new Error(`${this.kind} segment ${number} is no longer held`));
        }

        return new Promise((resolve, reject) => {
            const waiting = this.readers.get(number) || [];
            const timer = setTimeout(() => {
                this.readers.set(number, (this.readers.get(number) || []).filter((r) => r.reject !== reject));
                reject(new Error(`${this.kind} segment ${number} stalled at ${upto} bytes`));
            }, FRAGMENT_WAIT);

            waiting.push({
                upto,
                resolve: (part) => { clearTimeout(timer); resolve(part); },
                reject: (error) => { clearTimeout(timer); reject(error); }
            });

            this.readers.set(number, waiting);
        });
    }

    static flatten(part) {
        if (part.chunks.length > 1) {
            part.chunks = [Buffer.concat(part.chunks, part.length)];
        }
        return part.chunks[0] || Buffer.alloc(0);
    }

    forget(number) {
        const part = this.parts.get(number);
        if (!part) return undefined;

        this.parts.delete(number);
        this.have.delete(number);
        this.bytesHeld -= part.length;
        heldInMemory -= part.length;

        (this.readers.get(number) || []).forEach((reader) =>
            reader.reject(new Error(`${this.kind} segment ${number} was released`)));
        this.readers.delete(number);

        return undefined;
    }

    async bytes(number) {
        const part = await this.until(number, Infinity);
        return Track.flatten(part);
    }

    async head(number, length) {
        const part = await this.until(number, length);
        return Track.flatten(part).subarray(0, length);
    }

    pour(number, start, end) {
        const from = start || 0;
        const track = this;

        return Readable.from((async function* pouring() {
            let at = from;

            for (;;) {
                const upto = end === undefined ? at + 1 : Math.min(end + 1, at + 1);
                const part = await track.until(number, upto);
                const whole = Track.flatten(part);

                const stop = end === undefined ? whole.length : Math.min(end + 1, whole.length);
                if (at < stop) {
                    yield whole.subarray(at, stop);
                    at = stop;
                }

                if (end !== undefined && at > end) return;
                if (part.complete && at >= whole.length) return;
            }
        }()));
    }

    release() {
        this.parts.forEach((part) => { heldInMemory -= part.length; });
        this.parts.clear();
        this.bytesHeld = 0;
        this.readers.forEach((waiting) => waiting.forEach((reader) =>
            reader.reject(new Error(`${this.kind} stopped`))));
        this.readers.clear();

        this.waiting.forEach((waiters) => waiters.forEach((waiter) => {
            clearTimeout(waiter.timer);
            waiter.reject(new Error(`${this.kind} stopped`));
        }));
        this.waiting.clear();
    }

    reach(number) {
        if (this.have.has(number) || this.parts.has(number)) return Promise.resolve();
        if (this.failure) return Promise.reject(this.failure);
        if (this.stopped) return Promise.reject(new Error(`${this.kind} is no longer being fetched`));

        if (number > 0 && this.index && !this.reachable(number)) this.seekTo(number);

        // Only `want` frees window bytes; without this call the reader and downloader deadlock.
        if (number > this.wanted) this.want(number);

        return new Promise((resolve, reject) => {
            const waiters = this.waiting.get(number) || [];

            const patience = number > this.next ? setTimeout(() => {
                if (this.parts.has(number) || this.stopped || this.restartAt) return;
                if (number <= this.next) return;

                journal.service('seek', `${this.kind} segment ${number} has not begun after `
                    + `${REACH_PATIENCE}ms at ${this.next}; moving the stream to it`);

                this.seekTo(number);
            }, REACH_PATIENCE) : null;

            const timer = setTimeout(() => {
                clearTimeout(patience);
                this.waiting.delete(number);
                reject(new Error(`${this.kind} segment ${number} did not arrive in time`));
            }, FRAGMENT_WAIT);

            waiters.push({
                timer,
                resolve: () => { clearTimeout(patience); resolve(); },
                reject: (error) => { clearTimeout(patience); reject(error); }
            });

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
        const first = (this.index || [])[0];

        if (!this.stopped && !this.restartAt && this.from && this.fallbacks < FALLBACKS && first) {
            this.fallbacks += 1;
            this.restartAt = first.number;

            journal.service('run', `${this.kind} refused at segment ${this.from} `
                + `(${error.message.slice(0, 60)}); starting from the beginning instead `
                + `(${this.fallbacks} of ${FALLBACKS})`);

            if (this.abort) {
                try { this.abort(); } catch (e) {}
            }

            // Waiters are left alone deliberately: the restart is coming and will answer them.
            return;
        }

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

        // Release here, not in the download loop: that loop waits behind the gate this opens.
        this.forgetBehind();
    }

    get behind() {
        return Math.max(this.wanted, this.from ? this.from - 1 : 0);
    }

    get ahead() {
        let bytes = 0;

        this.parts.forEach((part, number) => {
            if (number === 0 || number >= this.wanted) bytes += part.length;
        });

        return bytes;
    }

    get segmentBytes() {
        if (this.typical) return this.typical;
        if (!this.index || !this.index.length) return 0;

        const sizes = this.index.map((one) => one.end - one.start + 1).sort((a, b) => a - b);

        this.typical = sizes[Math.floor(sizes.length / 2)] || 0;
        return this.typical;
    }

    get windowBytes() {
        return Math.min(Math.max(WINDOW_BYTES, this.segmentBytes), HELD_CEILING - TAIL_BYTES);
    }

    get tailBytes() {
        return Math.min(Math.max(TAIL_BYTES, this.segmentBytes * 2), HELD_CEILING - this.windowBytes);
    }

    get satisfied() {
        return this.ahead >= this.windowBytes;
    }

    forgetBehind() {
        const behind = [...this.parts.keys()]
            .filter((number) => number > 0 && number < this.wanted)
            .sort((a, b) => b - a);

        let kept = 0;

        behind.forEach((number) => {
            const part = this.parts.get(number);
            if (kept < this.tailBytes) {
                kept += part.length;
                return;
            }
            this.forget(number);
        });

        [...this.parts.keys()]
            .filter((number) => number > this.next)
            .forEach((number) => this.forget(number));

        return Promise.resolve();
    }
}

function pick(formats, kind, maxHeight, chosen, xtags, hdr) {
    // Video keeps WebM — many videos offer no indexed MP4 above 1080p — but seeking into WebM
    // freezes the decoder unrecoverably. Audio stays MP4.
    const container = kind === 'video'
        ? (format) => MP4.test(format.mimeType || '') || WEBM.test(format.mimeType || '')
        : (format) => MP4.test(format.mimeType || '');

    const wanted = formats
        .filter(container)
        .filter(preIndexed)
        .filter((format) => (kind === 'video' ? !!format.height : !format.height));

    // An empty `xtags` means the default track, so it is distinct from not being told.
    if (kind === 'audio') {
        if (typeof xtags === 'string') {
            const said = wanted.filter((format) => (format.xtags || '') === xtags);
            if (said.length) return said[0];
        }

        const asChosen = wanted.filter((format) => (chosen || []).some((one) =>
            one.itag === format.itag && (one.xtags || '') === (format.xtags || '')));

        return asChosen[0] || wanted.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0] || null;
    }

    const offered = wanted.filter((format) => !maxHeight || format.height <= maxHeight);

    const best = (formats) => formats
        .sort((a, b) => (b.height - a.height)
            || ((b.fps || 30) - (a.fps || 30))
            || (hdr ? (isHdr(b) ? 1 : 0) - (isHdr(a) ? 1 : 0) : (isHdr(a) ? 1 : 0) - (isHdr(b) ? 1 : 0))
            || ((MP4.test(a.mimeType || '') ? 0 : 1) - (MP4.test(b.mimeType || '') ? 0 : 1))
            || ((isTenBit(a) ? 1 : 0) - (isTenBit(b) ? 1 : 0)))[0] || null;

    return best(offered);
}

function readIndex(carry, format) {
    if (WEBM.test((format && format.mimeType) || '')) {
        const index = webm.segmentIndex(carry, format.contentLength, format);

        return index && {
            init: index.init,
            segments: index.segments,
            timescale: index.timescale,
            cues: index.cues,
            setup: index.setup
        };
    }

    const sidx = mp4.boxes(carry).filter((box) => box.type === 'sidx')[0];
    if (!sidx) return null;

    const index = mp4.segmentIndex(carry);
    if (!index) return null;

    return {
        init: { start: 0, end: sidx.end - 1 },
        segments: index.segments,
        timescale: index.timescale,
        cues: { start: sidx.start, end: sidx.end - 1 },
        setup: { start: 0, end: sidx.start - 1 }
    };
}

function stateFor(track, records, number, durationMs) {
    const before = (track.index || []).filter((segment) => segment.number < number);
    if (!before.length || records.size < 2) return null;

    // Segment 0 is the init segment and is not in the index; leave it out of the claim and the
    // server refuses the stream with `Missing segments: [0]`.
    const claimed = [{ number: 0, durationMs: 0, startMs: 0 }].concat(before);

    const headers = claimed.map((segment) => ({
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

    journal.service('claim', `${track.kind} claims under ${mine}; `
        + `stream reported ${[...records.keys()].join(' ') || 'nothing'}`);

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

        if (!track.restartAt) await asked(track);
        if (track.stopped || track.failure) break;
    }

    if (!track.index) track.broke(new Error(`${track.kind} arrived without a segment index`));

    async function run(from) {
        const at = (track.index || []).filter((segment) => segment.number === from)[0];

        const first = track.index ? track.index[0].number : 1;
        const positioned = Boolean(from && from > first);
        const state = positioned ? stateFor(track, records, from, Number(params.durationMs)) : null;

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

                if (!segment || !held) return;

                if (base < segment.start) {
                    throw new Error(`${track.kind} segment ${track.next} starts at ${segment.start} but the stream is at ${base}`);
                }

                const wanted = Math.min(held, segment.end - base + 1);
                track.grow(track.next, take(wanted));
                base += wanted;

                if (base <= segment.end) return;

                track.settle(track.next);
                track.verify(track.next);

                if (track.next === from || track.next === (track.index[0] || {}).number) {
                    const head = Track.flatten(track.parts.get(track.next) || { chunks: [] });

                    journal.service('run', `${track.kind} ${track.format.itag} completed segment `
                        + `${track.next}, ${head.length} bytes cut for ${segment.end - segment.start + 1}`
                        + `, starts ${head.subarray(0, 24).toString('hex')}`
                        + `, manifest says ${segment.startMs}ms`);
                }

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
                    const whole = track.index ? track.index[track.index.length - 1].end + 1 : 0;
                    const mb = (bytes) => (bytes / 1048576).toFixed(1);

                    journal.service('run', `${track.kind} ${track.format.itag} from ${from || 0} ended`
                        + ` after ${mb(arrived)}MB${done ? ', server closed' : ''}`
                        + `${track.restartAt ? `, moving to ${track.restartAt}` : ''}`
                        + ` — holding ${mb(track.bytesHeld)}MB in ${track.parts.size} parts`
                        + `, file is ${mb(whole)}MB`);
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
                        track.timescale = read.timescale || 1000;
                        track.cues = read.cues || null;
                        track.setup = read.setup || null;
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

        // SABR sends a portion at a time; a close short of the last segment is normal, not the end.
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

    const since = params.fresh ? [...sessions.values()]
        .filter((one) => one.videoId === params.videoId && one.ready)
        .reduce((latest, one) => Math.max(latest, one.at), 0) : 0;

    const taken = await sabr.awaitSession(params.ustreamerConfig, null, since || undefined);

    const chosen = {
        video: pick(params.formats, 'video', params.maxHeight, null, undefined, params.hdr),
        audio: pick(params.formats, 'audio', null, taken.selected, params.audioXtags)
    };

    if (!chosen.video || !chosen.audio) {
        const shown = (params.formats || []).slice(0, 24).map((one) => {
            const type = /^(video|audio)\/(\w+)/.exec(one.mimeType || '');
            return `${one.itag}${one.height ? `:${one.height}p` : ''}`
                + `${type ? `/${type[2]}` : ''}${preIndexed(one) ? '' : ' unindexed'}`;
        }).join(' ');

        journal.service('pick', `${params.videoId}: nothing to choose — `
            + `${(params.formats || []).length} formats offered: ${shown}`);
    }

    if (!chosen.video) throw new Error('this response offers no MP4 video track');
    if (!chosen.audio) throw new Error('this response offers no MP4 audio track');

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

        // The element asks a segment or two behind the resume point; landing on it costs a restart.
        const first = track.index[0].number;
        const wanted = Math.max(first, holding.number - LEAD_IN);
        const at = track.index.filter((segment) => segment.number === wanted)[0];

        if (!at || at.number === first) return;

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
            journal.service('sweep', `${session.id} unread for `
                + `${Math.round((now - session.read) / 1000)}s; dropping it`);
            return close(session.id);
        }));
}

async function close(id) {
    const session = sessions.get(id);
    if (!session) return false;

    sessions.delete(id);

    for (const track of Object.values(session.tracks)) {
        track.stopped = true;
        track.release();
        if (track.abort) {
            try { track.abort(); } catch (e) {}
        }
    }

    await rm(join(MEDIA_DIR, id), { recursive: true, force: true }).catch(() => {});
    return true;
}

// Left by tooling that no longer exists; nothing else removes them.
const ABANDONED = ['clips'];

async function clean() {
    await rm(MEDIA_DIR, { recursive: true, force: true }).catch(() => {});
    await mkdir(MEDIA_DIR, { recursive: true }).catch(() => {});

    heldInMemory = 0;

    const beside = join(MEDIA_DIR, '..');
    await Promise.all(ABANDONED.map((name) => rm(join(beside, name), { recursive: true, force: true })
        .catch(() => {})));
}

module.exports = {
    HEAD_BYTES, IDLE_TIMEOUT, MEDIA_DIR, READ_AHEAD,
    SEGMENT_WAIT, SWEEP_INTERVAL, Track, WINDOW_BYTES, TAIL_BYTES, holding,
    align, awaitVideo, beginAt, busy, clean, close, fill, indexed, locate, open, pick, sessions, span, stateFor, sweep
};
