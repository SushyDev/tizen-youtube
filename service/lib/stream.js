'use strict';

// Fetches a video's media over SABR a segment at a time, keeping only what is near the
// playhead.

const { mkdir, rm } = require('fs/promises');
const { Readable } = require('stream');
const { join } = require('path');

const journal = require('./journal.js');
const mp4 = require('./mp4.js');
const webm = require('./webm.js');
const sabr = require('./sabr.js');

const MEDIA_DIR = process.env.TUBE_MEDIA_DIR || '/home/owner/share/tube/media';

const SEGMENT_WAIT = 30000;

// How long one fragment request may be held before it is refused. Not a patience setting —
// a socket budget. Fragments and the proxied youtube.com share an origin, so they share the
// six connections a browser opens to a host, and a request waiting here is one the page
// cannot use for anything else. At thirty seconds, six slow or stranded fragments close the
// pool for everyone: no next fragment, no thumbnails, nothing, until something else frees
// them. Measured, no fragment that was going to arrive has ever taken more than 1.7s, so
// this is a third of what it was, which is what was asked for, and still far below the point
// where a stalled pool starves the page. Three seconds — tried briefly — is not enough: an
// AV1 2160p fragment here is sixteen megabytes and takes 1.8s to send when nothing is wrong,
// so a slow one was refused for being slow and the set had to ask again.
const FRAGMENT_WAIT = 10000;

// How many times a track may be refused for its position and start over before it is
// treated as broken. One was not enough: a stream recovers, fetches for a while, is asked
// for another position, is refused again, and the single chance has already been spent —
// which killed a video mid-playback after a quality change. A count rather than no limit,
// so a stream that is genuinely refusing everything still stops.
const FALLBACKS = 3;
const INDEX_WAIT = 10000;

// How far ahead a segment can be and still be worth waiting for rather than restarting the
// stream to reach. Not a buffer size — what is held is bounded by WINDOW_BYTES below — only
// the distance at which "it is coming" stops being true.
const READ_AHEAD = 10;

// How much of that distance is worth crawling rather than restarting for. The count above
// says nothing about size, and size is the whole question: four segments is eight megabytes
// at 2160p and about a megabyte at 360p. Measured, a restart reaches first bytes in 22-754ms
// while the crawl runs at 1-3MB/s, so anything past a couple of megabytes is cheaper to
// move to. Sequential reading is unaffected — the next segment along is a gap of zero.
const REACH_BYTES = 3 * 1024 * 1024;


// And how long that wait may actually last. Counting segments says nothing about time: ten
// of them is a moment at 360p and twenty megabytes at 2160p. A seek eight segments ahead
// was answered in 5,063ms because the download was left to crawl there, and the set does
// not survive it — the element stopped asking for anything at all, the page stopped running
// with it, and a quality change pressed six hundred milliseconds later went unheard for
// ninety-six seconds. A restart reaches first bytes in 59-211ms, measured, so waiting
// longer than this is never the cheaper thing to do. Only for a segment genuinely ahead of
// the stream: the one being written now is already arriving, and moving to it would be a
// restart loop.
const REACH_PATIENCE = 1500;

// Tries at a quarter of a second each.
const POSITION_TRIES = 40;

// Segments before a resume position to begin at, so the element's own first request is
// already being fetched rather than costing a second restart.
const LEAD_IN = 2;

const IDLE_TIMEOUT = 45 * 1000;
const SWEEP_INTERVAL = 15 * 1000;
const HEAD_BYTES = 128 * 1024;

// What a track may hold at once, in bytes rather than in segments. YouTube's own client
// fetches about a megabyte at a time and keeps roughly thirty in a SourceBuffer whatever
// the bitrate; counting segments instead meant twenty-five of them, which is 450MB at
// 2160p60 and is what filled televisions. Video reaches this; audio never comes near it.
const WINDOW_BYTES = Number(process.env.TUBE_WINDOW_BYTES || 12 * 1024 * 1024);

// And how much of what has been played to keep. This is not a nicety: the platform's
// player re-asks for segments it has already read — a resume hands it `#t=`, and the
// fragment never reaches the server, so it starts at zero and then jumps. A segment that
// has been dropped and is asked for again restarts the whole stream, measured at four
// seconds of nothing. Six megabytes was a third of one 2160p60 segment, so every such ask
// missed. This is a little over two of them, and forty at 720p.
const TAIL_BYTES = Number(process.env.TUBE_TAIL_BYTES || 16 * 1024 * 1024);

// Twenty-eight megabytes between them, down from sixty-four. That ceiling was set against
// 2160p VP9, where a segment is about four megabytes and sixty-four buys a comfortable
// sixteen of them. AV1 at the same height is a different proposition entirely — one segment
// is sixteen megabytes and a whole file 648MB — and sixty-four megabytes of Node heap on a
// television, beside whatever the platform is holding of the same video, is enough to take
// the set down rather than merely the video: the viewer could not press Back.
//
// Held in bytes for exactly this reason, so the bitrate cannot decide the footprint. The
// numbers were still chosen against the cheaper codec.

// The most one track may hold, however large its segments are. Sizing the window against
// the media is right, and letting it grow without limit is how a television stops answering
// at all: sixty-four megabytes of one video in Node heap, beside whatever the platform holds
// of the same, took the whole set down and not merely the video. Forty-eight is comfortably
// under that and still three AV1 segments.
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

        // Segments as they arrive, not once they have arrived. `parts` holds the pieces a
        // segment has been sent in, so a reader can be answered from the front of it while
        // the back is still coming — which is what makes a window this small playable at
        // all. `have` still means complete.
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

        // And everything still waiting on a segment this jump leaves behind is refused now,
        // rather than left to sit out its thirty seconds.
        //
        // Those are the set's own requests, and they are held against a limit of six
        // connections to a host that the whole page shares — the proxy serving youtube.com
        // is the same origin as the fragments. A seek strands whatever was in flight, six of
        // them close the pool, and then nothing can be fetched at all: not the next
        // fragment, not a thumbnail, not anything. The video does not stop because the bytes
        // are late. It stops because there is no socket left to ask on, which is why it
        // recovers the moment the session is swept and the sockets go with it.
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

    // A stream that has ended or is parked never reaches anything, however close it stands,
    // so being within read-ahead is not on its own enough.
    reachable(number) {
        if (!this.running) return false;

        // Being read towards on purpose. It may be a long way off in bytes and it is still
        // coming, and seeking to it would abandon the very catch-up that is fetching it.
        if (number < this.next || number > this.next + READ_AHEAD) return false;

        // Within read-ahead by count. Whether it is within reach by weight is the question
        // the set is actually asking, and the one a seek at 2160p answers differently: a
        // spinner seconds long, measured at 5,063ms, for a segment the count called near.
        if (!this.index) return true;

        const here = this.index.filter((segment) => segment.number === this.next)[0];
        const there = this.index.filter((segment) => segment.number === number)[0];

        if (!here || !there) return true;

        return there.start - here.end <= REACH_BYTES;
    }

    file(number) {
        return join(this.dir, number === 0 ? 'init.mp4' : `${number}.m4s`);
    }

    // One piece of a segment, published the moment it lands rather than when the segment
    // is whole. Everything waiting on these bytes is answered here.
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

    // Anything waiting for this segment to exist can go now; anything waiting for a
    // particular byte of it is handled by `serve`.
    began(number) {
        (this.waiting.get(number) || []).forEach((waiter) => {
            clearTimeout(waiter.timer);
            waiter.resolve();
        });
        this.waiting.delete(number);
    }

    // Whether a segment begins where a segment is supposed to begin. The index is read from
    // the file for MP4 — a `sidx` states every offset — but derived for WebM, where it is
    // built from cue points, and the specification is explicit that cues need only mark
    // "important locations" rather than every cluster. So a boundary here is an assumption
    // in one container and a fact in the other, and an assumption that is wrong hands the
    // decoder a fragment that begins in the middle of something.
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

        // Once per track. A misaligned index misaligns everything after it, and one line
        // saying so is the finding; five hundred is a flood that hides it.
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

    // Resolves once `upto` bytes of the segment exist, or the segment is complete and never
    // will have that many. A reader is never given a short read without the segment ending.
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

    // The whole segment. Only the initialization segment is read this way.
    async bytes(number) {
        const part = await this.until(number, Infinity);
        return Track.flatten(part);
    }

    // The first bytes, for the fragment header rewritten on the way out.
    async head(number, length) {
        const part = await this.until(number, length);
        return Track.flatten(part).subarray(0, length);
    }

    // A range, given out as it arrives rather than once it is all here.
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

    // Everything this track is holding, for when its session goes.
    release() {
        this.parts.forEach((part) => { heldInMemory -= part.length; });
        this.parts.clear();
        this.bytesHeld = 0;
        this.readers.forEach((waiting) => waiting.forEach((reader) =>
            reader.reject(new Error(`${this.kind} stopped`))));
        this.readers.clear();

        // And everything waiting for a segment to begin, which this used to leave behind.
        // A viewer who left one video for another stranded the requests the old one had in
        // flight: nothing rejected them, so each sat out its full thirty seconds and then
        // reported itself refused, long after the video it belonged to was gone. Harmless
        // to playback and thoroughly confusing to read.
        this.waiting.forEach((waiters) => waiters.forEach((waiter) => {
            clearTimeout(waiter.timer);
            waiter.reject(new Error(`${this.kind} stopped`));
        }));
        this.waiting.clear();
    }

    reach(number) {
        // Started is enough: the reader takes bytes as they land, and waiting for the whole
        // segment is what made the window have to be segments deep in the first place.
        if (this.have.has(number) || this.parts.has(number)) return Promise.resolve();
        if (this.failure) return Promise.reject(this.failure);
        if (this.stopped) return Promise.reject(new Error(`${this.kind} is no longer being fetched`));

        if (number > 0 && this.index && !this.reachable(number)) this.seekTo(number);

        // Asking for it is wanting it. The window is bounded by bytes and only `want`
        // frees any, so a read for a segment past the end of the window would otherwise
        // wait for a playhead that cannot move until this very read completes: the
        // downloader sits at a full window, the reader sits on a segment it will never
        // fetch, and thirty seconds later the segment is refused and the session is swept
        // for being idle. Seen on the television as a video stopping dead at 41s with the
        // service holding nothing.
        if (number > this.wanted) this.want(number);

        return new Promise((resolve, reject) => {
            const waiters = this.waiting.get(number) || [];

            // The read-ahead test above only asked whether the stream would reach this
            // eventually. This asks whether it is going to be quick about it, which is the
            // question the set is really putting, and answers it by moving the stream
            // rather than by going on waiting.
            const patience = number > this.next ? setTimeout(() => {
                // Asked again when it fires, not only when it was set. The stream moves
                // while this waits, and a segment that was four ahead at the start can be
                // the one being written by the time the timer comes round — restarting for
                // it then abandons the delivery that was already under way and asks for the
                // same bytes a second time.
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
        // A stream asked to begin partway through can be refused for the claim it makes
        // rather than for anything wrong with the media: the server answers `Missing
        // segments: [0]`, and segment zero is the initialization segment, held apart from
        // the index and so never named in the claim. The bytes are there; the description
        // of them is wrong.
        //
        // Treating that as a broken track is terminal — `failure` rejects every later read
        // for the life of the session, so the picture carries on while the sound it was
        // fetching can never be asked for again. Starting over from the beginning costs the
        // download again, which for audio is a couple of megabytes, and keeps the track
        // alive. Once only, so one that is genuinely broken still stops.
        //
        // Here rather than at the one call site that used to have it: a track gets poisoned
        // from several paths, and the first version only covered the one I happened to be
        // looking at while the refusals went on arriving from another.
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

            // Waiters are left alone deliberately: the restart is on its way and rejecting
            // them now turns a slower segment into a refused one.
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

        // Releasing here, where the player is, and not in the download loop. The window is
        // measured in bytes now, so bytes are only freed by this — and the loop that used
        // to do it is the one waiting behind the gate that this opens. Doing it there
        // deadlocked: full window, blocked loop, nothing released, nothing fetched.
        this.forgetBehind();
    }

    get behind() {
        return Math.max(this.wanted, this.from ? this.from - 1 : 0);
    }

    // Only what is at or ahead of the player counts. The tail behind it is held for a
    // rewind, not as read-ahead, and counting it here meant a tail large enough to be
    // useful kept the gate shut and starved the download of the thing it was fetching.
    get ahead() {
        let bytes = 0;

        this.parts.forEach((part, number) => {
            if (number === 0 || number >= this.wanted) bytes += part.length;
        });

        return bytes;
    }

    // Full when the read-ahead is full, whatever that is in segments — one and a half at
    // 2160p60, five at 720p. Bounded by bytes, so the bitrate cannot decide the footprint.
    // A segment's own size, taken from the index rather than assumed. The byte figures below
    // were chosen against 2160p VP9, where a segment is about four megabytes; AV1 at the same
    // height runs to fifteen, so both the window and the tail came out smaller than a single
    // segment. That holds less than one segment ahead and barely one behind, which is why
    // every seek on AV1 landed outside what was held and paid for a stream restart.
    get segmentBytes() {
        if (this.typical) return this.typical;
        if (!this.index || !this.index.length) return 0;

        // The middle one, not the largest: a single outsized segment should not size the
        // whole window.
        const sizes = this.index.map((one) => one.end - one.start + 1).sort((a, b) => a - b);

        this.typical = sizes[Math.floor(sizes.length / 2)] || 0;
        return this.typical;
    }

    // Enough to be worth having, whatever the bitrate: two segments ahead and one and a half
    // behind, or the byte figures, whichever is larger.
    // One segment ahead, two behind, and the weight is deliberate. Read-ahead is largely the
    // set's job — it keeps twenty to thirty seconds buffered itself and asks well before it
    // needs anything — so holding much ahead of that duplicates its work. What only this can
    // hold is the tail, and the tail is what a seek backwards lands in.
    //
    // It is worth holding: a restart positioned behind where the stream has already reached
    // costs about eleven seconds before the server sends a byte, measured twice at 10878ms
    // and 10827ms, against 165ms for a fresh start and 756ms for a restart positioned
    // forward. Every segment kept behind is a backward seek that never pays that.
    get windowBytes() {
        return Math.min(Math.max(WINDOW_BYTES, this.segmentBytes), HELD_CEILING - TAIL_BYTES);
    }

    get tailBytes() {
        return Math.min(Math.max(TAIL_BYTES, this.segmentBytes * 2), HELD_CEILING - this.windowBytes);
    }

    get satisfied() {
        return this.ahead >= this.windowBytes;
    }

    // Keeping a tail measured in bytes, so a small rewind is served rather than restarting
    // the stream, and a large one is not paid for by everybody.
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

        // Anything past where the stream now is was fetched for a position it has left.
        [...this.parts.keys()]
            .filter((number) => number > this.next)
            .forEach((number) => this.forget(number));

        return Promise.resolve();
    }
}

function pick(formats, kind, maxHeight, chosen, xtags, hdr) {
    // MP4 only, picture and sound alike.
    //
    // WebM was allowed here because VP9 was believed to be the only 2160p60 this hardware
    // decoded cleanly. That stopped being true — AV1 holds the same size and rate without
    // dropping a frame — and WebM now costs something VP9 never repaid: a seek into it
    // freezes the decoder and cannot be recovered. The same jump in AV1 freezes too and comes
    // back when playback is restarted; a WebM one stays frozen and takes the page with it.
    //
    // It also settles a disagreement. The page only takes a video over when an indexed MP4
    // picture exists, and this then served the tallest rung whatever its container — so a
    // video was accepted on the strength of an MP4 that was never the one served.
    //
    // The cost is a lower rung where a video's tallest picture is WebM, and nothing at all
    // where it has no indexed MP4 — the page keeps those, and seeks them with its own player.
    // Picture may be WebM; sound stays MP4. WebM is not optional here: plenty of videos
    // offer no indexed MP4 above 1080p, and dropping it caps those at 1080p — which is the
    // enhanced player failing to do the one thing it exists for. Seeking into WebM is broken
    // and that is ours to fix, not a reason to stop carrying the container.
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

    // Tallest, then fastest, then the wider colour, then MP4, then the shallower depth.
    // Colour rather than depth: ten bits on BT.709 material is only a bigger file.
    //
    // MP4 ahead of depth, which it did not used to be, because the container decides whether
    // seeking works rather than how large the file is. A seek completes and leaves the
    // decoder showing the picture it already had; restarting playback reaches that decoder
    // through an MP4 stream and does not through a WebM one, so the same jump recovers in a
    // second on AV1 and stays frozen on VP9. Depth is a preference. Being able to seek is
    // not, and it was decided here by a tie-break nobody was thinking about seeking when
    // they wrote.
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

    // The same shape WebM reports, from the box that does the same job. `sidx` is an MP4's
    // own segment index, so a manifest can point the set at it and let it fetch byte ranges
    // rather than numbered segments that were invented on the file's behalf — which is what
    // YouTube's own manifests do, and what stopped a seek freezing in WebM.
    return {
        init: { start: 0, end: sidx.end - 1 },
        segments: index.segments,
        timescale: index.timescale,
        cues: { start: sidx.start, end: sidx.end - 1 },
        setup: { start: 0, end: sidx.start - 1 }
    };
}

// What the stream has to be told it already holds to continue from a segment rather than
// from the beginning. The library offers no position except this resume state, whose
// segment durations the file's own index supplies exactly.
function stateFor(track, records, number, durationMs) {
    const before = (track.index || []).filter((segment) => segment.number < number);
    if (!before.length || records.size < 2) return null;

    // Segment zero is the initialization segment. It is held apart from the index — the index
    // numbers the media segments from one — so it has never appeared in a claim, and the
    // server counts it: it answers `Missing segments: [0]. Expected range: 0-30.` and refuses
    // the stream outright. That refusal is what a seek at 2160p actually died of. The
    // fragment at the new position was served correctly and quickly; two seconds later the
    // stream behind it was rejected for its claim, fell back to the beginning, re-fetched the
    // file from segment one, and left the element sitting at ninety-nine seconds with nothing
    // coming for it ever again.
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

    // Which key this track claims under, against the keys the stream actually reported. If
    // they differ the claim goes out with no segments named for this format at all, which
    // is what the server calls `Missing segments: [0]` — and the `claiming N segments` line
    // below would not show it, because it reports the first format that has any, which is
    // the other track.
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

                if (!segment || !held) return;

                // `base` is where the stream stands inside this segment, not only at its
                // start, because bytes are handed over as they arrive rather than once the
                // segment is whole. It has to agree at the boundary all the same.
                if (base < segment.start) {
                    throw new Error(`${track.kind} segment ${track.next} starts at ${segment.start} but the stream is at ${base}`);
                }

                // Only ever this segment's own bytes: the next one is a separate reader.
                const wanted = Math.min(held, segment.end - base + 1);
                track.grow(track.next, take(wanted));
                base += wanted;

                // Still filling. Whatever has landed is already readable.
                if (base <= segment.end) return;

                track.settle(track.next);
                track.verify(track.next);

                if (track.next === from || track.next === (track.index[0] || {}).number) {
                    // With the first bytes of it. A stream restarted mid-file is trusted to
                    // begin exactly where it was asked to, and nothing here has ever checked
                    // that: if it begins a segment early or late the byte count still comes
                    // out right, the segment still reports itself complete, and the set is
                    // handed a fragment that is the correct size and the wrong content. That
                    // is indistinguishable from every other failure until these are compared
                    // against a segment cut from a stream that ran from the start.
                    const head = Track.flatten(track.parts.get(track.next) || { chunks: [] });

                    // With what the manifest promised beside it. A cluster carries its own
                    // timecode and a fragment its own decode time, so the bytes can say where
                    // they belong — and if that disagrees with the segment they were cut as,
                    // the set is being handed the right amount of the wrong media, which is
                    // the one failure that leaves no trace at either end.
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
                    // Arrived, kept, and the whole file, on one line. What a stream pulls and
                    // what it still holds are different numbers and the gap between them is
                    // the download being paid for twice: bytes fetched, cut into segments,
                    // and evicted before anything read them. Without all three here the run
                    // line looks healthy at any size.
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

    // What was on offer, when nothing could be taken from it. A video that will not open
    // says only that it did not, and the answer is always in the ladder it was given —
    // whether the pictures were all WebM, all live, all encrypted, or simply absent.
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
            // Journal, not stdout. Nothing collects a service's stdout on a television, so
            // the one line that explained why a video died went nowhere: the log simply
            // stopped after the last download and the set showed a frozen frame. This is
            // the record everything else here is read from.
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

// Written by tooling that no longer exists, and nothing has ever removed them. A set that
// has been through a few builds is carrying these for no reason at all.
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
