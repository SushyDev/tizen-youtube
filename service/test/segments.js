'use strict';

// The segment index and the cutting that depends on it. SABR delivers one byte stream and
// the file's own index says where each segment begins and ends inside it, so getting these
// offsets wrong means either nothing is written or the wrong bytes are served — both of
// which have happened, and neither of which shows up as an error anywhere.

const { mkdtempSync, readFileSync, existsSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const results = [];
function check(name, ok, detail) {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
}

const dir = mkdtempSync(join(tmpdir(), 'tube-segments-'));
process.env.TUBE_MEDIA_DIR = join(dir, 'media');

const mp4 = require('../lib/mp4.js');
const stream = require('../lib/stream.js');

/** A box with a four-character type and a body. */
function box(type, body) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length + 8, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body]);
}

/** An initialization segment shaped like YouTube's: ftyp, moov, then the index. */
function initSegment(segments, timescale) {
    const references = Buffer.concat(segments.map(({ size, duration }) => {
        const entry = Buffer.alloc(12);
        entry.writeUInt32BE(size, 0);                       // reference type 0, size
        entry.writeUInt32BE(duration * timescale / 1000, 4);
        entry.writeUInt32BE(0x90000000, 8);                 // starts with SAP
        return entry;
    }));

    const header = Buffer.alloc(20);
    header.writeUInt32BE(0, 0);              // version 0, flags
    header.writeUInt32BE(1, 4);              // reference id
    header.writeUInt32BE(timescale, 8);
    header.writeUInt32BE(0, 12);             // earliest presentation time
    header.writeUInt32BE(0, 16);             // first offset
    const counted = Buffer.alloc(4);
    counted.writeUInt16BE(0, 0);             // reserved
    counted.writeUInt16BE(segments.length, 2);

    return Buffer.concat([
        box('ftyp', Buffer.alloc(12, 1)),
        box('moov', Buffer.alloc(40, 2)),
        box('sidx', Buffer.concat([header, counted, references]))
    ]);
}

const SHAPE = [{ size: 1000, duration: 5000 }, { size: 2000, duration: 6000 }, { size: 1500, duration: 5000 }];
const init = initSegment(SHAPE, 1000);

// The whole file: the initialization segment, then each media segment in order.
const media = SHAPE.map((segment, at) => Buffer.alloc(segment.size, 100 + at));
const file = Buffer.concat([init, ...media]);

const index = mp4.segmentIndex(init);

check('the index is found in the initialization segment', !!index, 'segmentIndex returned nothing');
check('every segment is described', index && index.segments.length === SHAPE.length,
    index && `${index.segments.length} of ${SHAPE.length}`);

const first = index && index.segments[0];
check('the first segment starts where the index ends', first && first.start === init.length,
    first && `${first.start} rather than ${init.length}`);
check('segments are sized from the index', first && first.end - first.start + 1 === SHAPE[0].size,
    first && `${first.end - first.start + 1} rather than ${SHAPE[0].size}`);

const second = index && index.segments[1];
check('the second follows the first exactly', second && second.start === first.end + 1,
    second && `${second.start} rather than ${first.end + 1}`);
check('durations come through in milliseconds', second && second.durationMs === 6000,
    second && `${second.durationMs}`);

// Choosing formats. The same itag appears more than once — the same audio with its dynamic
// range compressed, or a dubbed track — so an itag does not name a format, and picking the
// louder of two by bitrate is picking at random.
const AUDIO = [
    { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130301, xtags: '' },
    { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130313, xtags: 'CggKA2RyYxIBMQ' },
    { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160000 }
];

const VIDEO = [
    { itag: 401, mimeType: 'video/mp4; codecs="av01.0.13M.08"', height: 2160, fps: 60 },
    { itag: 400, mimeType: 'video/mp4; codecs="av01.0.12M.08"', height: 1440, fps: 60 },
    { itag: 315, mimeType: 'video/webm; codecs="vp9"', height: 2160, fps: 60 }
];

// What the player says it is playing wins over anything inferred from its requests.
const said = stream.pick(AUDIO.concat(VIDEO), 'audio', null, [{ itag: 140, xtags: '' }], 'CggKA2RyYxIBMQ');
check('the track the player names is the one fetched',
    said && said.xtags === 'CggKA2RyYxIBMQ', said && `xtags ${said.xtags}`);

const isDefault = stream.pick(AUDIO.concat(VIDEO), 'audio', null, [{ itag: 140, xtags: 'CggKA2RyYxIBMQ' }], '');
check('an empty name means the default track, not "no answer"',
    isDefault && isDefault.xtags === '', isDefault && `xtags ${isDefault.xtags}`);

const chosenDrc = stream.pick(AUDIO.concat(VIDEO), 'audio', null, [{ itag: 140, xtags: 'CggKA2RyYxIBMQ' }]);
check('the audio the page chose is the one fetched, not the loudest',
    chosenDrc && chosenDrc.xtags === 'CggKA2RyYxIBMQ', chosenDrc && `xtags ${chosenDrc.xtags}`);

const chosenPlain = stream.pick(AUDIO.concat(VIDEO), 'audio', null, [{ itag: 140, xtags: '' }]);
check('the other variant of the same itag is a different choice',
    chosenPlain && chosenPlain.xtags === '', chosenPlain && `xtags ${chosenPlain.xtags}`);

check('webm is never chosen for sound',
    stream.pick(AUDIO.concat(VIDEO), 'audio', null, [{ itag: 251, xtags: '' }]).itag === 140, 'took the webm');

check('the tallest mp4 picture is chosen',
    stream.pick(VIDEO.concat(AUDIO), 'video', 2160).itag === 401, 'wrong format');
check('a ceiling is respected',
    stream.pick(VIDEO.concat(AUDIO), 'video', 1440).itag === 400, 'ignored the ceiling');

// Seeking. Playback resumes where the viewer left off, so the very first segment asked for
// is routinely one the stream has not reached — which has to move the stream, not wait.
const seeking = new stream.Track('video', { itag: 401, xtags: '' }, dir);
seeking.index = index.segments;
seeking.init = { start: 0, end: init.length - 1 };
seeking.next = 1;

check('a segment just ahead is waited for', seeking.reachable(2), 'would restart');
check('a segment far ahead is not', !seeking.reachable(400), 'would wait');

seeking.reach(3).catch(function () { /* the restart is what is being checked */ });
check('asking for one nearby does not move the stream', seeking.restartAt === null,
    `restartAt ${seeking.restartAt}`);

seeking.reach(400).catch(function () { /* no stream is running in this test */ });
check('asking for one far off moves the stream there', seeking.restartAt === 400,
    `restartAt ${seeking.restartAt}`);

// What the server has to be told, for it to answer from a segment rather than the start.
const records = new Map([
    ['401:', { formatId: { itag: 401, xtags: '' }, mimeType: 'video/mp4' }],
    ['140:', { formatId: { itag: 140, xtags: '' }, mimeType: 'audio/mp4' }]
]);

const claim = stream.stateFor(seeking, records, 3, 60000);
const before = index.segments.filter(function (s2) { return s2.number < 3; });

check('the claim reaches exactly up to the segment asked for',
    claim && claim.playerTimeMs === before.reduce(function (n, s2) { return n + s2.durationMs; }, 0),
    claim && `playerTimeMs ${claim.playerTimeMs}`);

const mine = claim && claim.initializedFormats.filter(function (f) { return f.formatKey === '401:'; })[0];
const other = claim && claim.initializedFormats.filter(function (f) { return f.formatKey === '140:'; })[0];

check('only this track claims to hold anything',
    mine && mine.downloadedSegments.length === before.length && other && other.downloadedSegments.length === 0,
    'the wrong track was claimed for');
check('both formats are named, which the restore requires',
    claim && claim.initializedFormats.length === 2, 'a format is missing');
check('a claim cannot be made before both formats are known',
    stream.stateFor(seeking, new Map(), 3, 60000) === null, 'made one anyway');

// Read-ahead opens up rather than running flat out from the first second.
const ahead = new stream.Track('video', { itag: 1 }, dir);

ahead.wanted = 1;
ahead.next = 5;
check('the download holds back while playback is starting', ahead.satisfied, 'kept fetching');

ahead.wanted = 9;
ahead.next = 12;
check('and opens up once it is under way', !ahead.satisfied, 'stopped too early');

// Seeking to the very start has nothing before it to claim, and must not be mistaken for a
// position that cannot be named.
check('no claim can be built for the first segment',
    stream.stateFor(seeking, records, index.segments[0].number, 60000) === null, 'built one');

// A stream that begins partway through has fetched nothing the player has asked for yet,
// and must not read that as being far ahead of it.
const jumped = new stream.Track('video', { itag: 1 }, dir);
jumped.from = 8;
jumped.next = 10;
jumped.wanted = 0;
check('a stream started partway through keeps fetching', !jumped.satisfied, 'stopped at once');

jumped.next = 25;
check('and stops once it is properly ahead', jumped.satisfied, 'never stopped');

// Seeking backwards leaves the segments from before it on disk. Measuring from those, or
// deleting relative to them, stops the download dead exactly when it is needed.
const back = new stream.Track('video', { itag: 1 }, dir);
back.have = new Set([0, 100, 101, 102, 103, 104]);
back.next = 21;
back.want(20);

check('the position follows a seek backwards', back.wanted === 20, `wanted ${back.wanted}`);
check('and the download does not think it is ahead', !back.satisfied, 'held off');

back.have = new Set([0, 12, 18, 19, 20, 100, 101]);
back.forgetBehind().then(function () {
    check('the initialization segment is never dropped', back.have.has(0), 'dropped it');
    check('what is watched and behind the window goes', !back.have.has(12), 'kept it');
    check('the window around the player stays', back.have.has(18) && back.have.has(20), 'dropped the window');
    check('what a seek stranded ahead goes too', !back.have.has(100) && !back.have.has(101), 'kept stale segments');
});

// A truncated head has no index in it yet, and must not be read as if it had one.
check('a partial initialization segment yields nothing',
    mp4.segmentIndex(init.subarray(0, init.length - 4)) === null, 'parsed anyway');
check('bytes that are not an initialization segment yield nothing',
    mp4.segmentIndex(Buffer.alloc(64)) === null, 'parsed anyway');

// Cutting: the stream arrives in chunks that do not line up with segments, and the first
// one can be larger than the head the index is looked for in.
async function cutting(name, chunks) {
    const track = new stream.Track('video', { itag: 1, mimeType: 'video/mp4' }, join(dir, name));
    require('fs').mkdirSync(track.dir, { recursive: true });

    const reader = (function* () { for (const chunk of chunks) yield chunk; })();

    const formats = { video: { itag: 1, mimeType: 'video/mp4' }, audio: { itag: 2, mimeType: 'audio/mp4' } };

    // Filling outlives the download: it stays up waiting to be sent somewhere else in the
    // file. Nothing will ask here, so the track is shut down as the chunks run out.
    await stream.fill(track, {}, formats, {
        follow: () => Promise.resolve({
            reader: {
                read: () => {
                    const next = reader.next();
                    if (next.done) track.stopped = true;
                    return Promise.resolve(next);
                }
            },
            abort: () => {}
        })
    });

    return track;
}

const sliced = (buffer, at) => {
    const chunks = [];
    for (let start = 0; start < buffer.length; start += at) chunks.push(buffer.subarray(start, start + at));
    return chunks;
};

(async () => {
    for (const [name, chunks] of [
        ['small-chunks', sliced(file, 64)],
        ['one-chunk', [file]],
        ['head-larger-than-the-window', [file.subarray(0, 3000), file.subarray(3000)]]
    ]) {
        const track = await cutting(name, chunks);

        check(`${name}: the index was read`, !!track.index, 'no index');
        check(`${name}: every segment was written`, track.have.size === SHAPE.length + 1,
            `${track.have.size} of ${SHAPE.length + 1}`);

        const wrote = existsSync(track.file(0)) && readFileSync(track.file(0));
        check(`${name}: the initialization segment is the head of the file`,
            wrote && wrote.equals(init), 'differs');

        const one = existsSync(track.file(1)) && readFileSync(track.file(1));
        check(`${name}: segment one is its own bytes`, one && one.equals(media[0]), 'differs');
    }

    console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed.`);
    process.exit(results.every(Boolean) ? 0 : 1);
})();
