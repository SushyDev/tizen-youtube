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

// A track named for a language is fetched as that language, not as the loudest on offer.
const DUBBED = [
    { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, xtags: 'lang-ja' },
    { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 129000, xtags: 'lang-en' }
];

const english = stream.pick(DUBBED, 'audio', null, [], 'lang-en');
check('the language the player names is the one fetched',
    english && english.xtags === 'lang-en', english && `xtags ${english.xtags}`);

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

// The same video is sometimes offered only as transcoded-on-the-fly formats, which carry
// no segment index. Every manifest here is written from that index, so one of those is not
// a format this can serve at any height.
const OTF = [
    { itag: 146, mimeType: 'video/mp4; codecs="avc1.640028"', height: 1080, fps: 30, type: 'FORMAT_STREAM_TYPE_OTF' },
    { itag: 148, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, xtags: '', type: 'FORMAT_STREAM_TYPE_OTF' }
];

check('a transcoded-on-the-fly picture is not chosen',
    stream.pick(OTF, 'video', 2160) === null, 'took a format with no index');
check('transcoded-on-the-fly sound is not chosen',
    stream.pick(OTF, 'audio', null, []) === null, 'took a format with no index');
check('an indexed format is still chosen beside them',
    stream.pick(OTF.concat(VIDEO), 'video', 2160).itag === 401, 'wrong format');

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

// Read-ahead opens up rather than running flat out from the first second. Written against
// the constants rather than the numbers they happen to hold: the opening allowance is a
// tuning decision — it was raised once already, to stop the decoder starting into an empty
// pipe — and a test that pins the number fails on every such change without finding a bug.
const ahead = new stream.Track('video', { itag: 1 }, dir);

// The allowance while starting is the opening figure plus whatever is already behind.
ahead.wanted = 1;
ahead.next = ahead.wanted + stream.READ_AHEAD_AT_FIRST + 1;
check('the download holds back while playback is starting', ahead.satisfied, 'kept fetching');

ahead.next = ahead.wanted + stream.READ_AHEAD_AT_FIRST;
check('and is still fetching before it has that much', !ahead.satisfied, 'stopped too early');

ahead.wanted = stream.READ_AHEAD + 4;
ahead.next = ahead.wanted + stream.READ_AHEAD - 1;
check('and opens up to the full window once it is under way', !ahead.satisfied, 'stopped too early');

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

// The manifest the set has to parse before it can show a frame. YouTube cuts at a constant
// cadence, so a long video collapses into a couple of runs — and a segment that breaks the
// cadence has to start its own run rather than be rounded into the last one, or every
// timestamp after it is wrong.
const dash = require('../lib/dash.js');

const evenly = Array.from({ length: 500 }, (_, at) => ({
    number: at + 1, startMs: at * 5000, durationMs: 5000, start: 0, end: 1
}));

const format = { itag: 1, mimeType: 'video/mp4; codecs="av01"', width: 3840, height: 2160, fps: 60, bitrate: 1 };
const asSession = (index) => ({
    id: 'x', videoId: 'y', durationMs: 2500000,
    tracks: { video: { kind: 'video', index, format }, audio: { kind: 'audio', index, format } }
});

const tidy = dash.manifest(asSession(evenly));
check('a constant cadence collapses to one run per track',
    (tidy.match(/<S /g) || []).length === 2, `${(tidy.match(/<S /g) || []).length} entries`);
check('the run says how many more follow the first',
    tidy.indexOf('r="499"') !== -1, 'repeat count missing or wrong');

const ragged = [
    { number: 1, startMs: 0, durationMs: 5000, start: 0, end: 1 },
    { number: 2, startMs: 5000, durationMs: 5000, start: 0, end: 1 },
    { number: 3, startMs: 10000, durationMs: 4200, start: 0, end: 1 },
    { number: 4, startMs: 14200, durationMs: 5000, start: 0, end: 1 }
];

const mixed = dash.manifest(asSession(ragged));
check('a segment that breaks the cadence starts its own run',
    (mixed.match(/<S /g) || []).length === 6, `${(mixed.match(/<S /g) || []).length} entries`);
check('and the odd length is stated exactly',
    mixed.indexOf('d="4200"') !== -1, 'the odd duration was lost');
check('only the first run carries a start time',
    (mixed.match(/ t="/g) || []).length === 2, 'more than one start time per track');

// Bit depth before height, above thirty frames a second. This set plays 2160p60 in eight
// bits without dropping a frame and stalls for seconds on the same rung in ten, and some
// videos offer nothing but ten-bit AV1 at the top.
const TEN_BIT = [
    { itag: 701, mimeType: 'video/mp4; codecs="av01.0.13M.10"', height: 2160, fps: 60 },
    { itag: 700, mimeType: 'video/mp4; codecs="av01.0.12M.10"', height: 1440, fps: 60 },
    { itag: 299, mimeType: 'video/mp4; codecs="avc1.64002a"', height: 1080, fps: 60 }
];

check('a rung with eight bits is taken over a taller one with ten',
    stream.pick(TEN_BIT, 'video', 2160).itag === 299, 'took the ten-bit picture');
check('eight bits at the top is still the tallest picture',
    stream.pick(VIDEO.concat(AUDIO), 'video', 2160).itag === 401, 'stepped down needlessly');
check('ten bits is fine below sixty frames a second',
    stream.pick([{ itag: 701, mimeType: 'video/mp4; codecs="av01.0.13M.10"', height: 2160, fps: 24 }],
        'video', 2160).itag === 701, 'stepped down at 24fps');
check('a longer codec string is read the same way',
    stream.pick([
        { itag: 701, mimeType: 'video/mp4; codecs="av01.0.13M.10.0.110.01.01.01.0"', height: 2160, fps: 60 },
        { itag: 299, mimeType: 'video/mp4; codecs="avc1.64002a"', height: 1080, fps: 60 }
    ], 'video', 2160).itag === 299, 'missed the depth field');
check('nothing but ten-bit still plays rather than nothing at all',
    stream.pick([{ itag: 701, mimeType: 'video/mp4; codecs="av01.0.13M.10"', height: 2160, fps: 60 }],
        'video', 2160).itag === 701, 'refused the only picture on offer');

// At 2160p60 the MP4 ladder offers only ten-bit AV1, which this hardware stalls on, while
// its VP9 path plays that size without dropping a frame — and VP9 is only ever in WebM.
// This is the real ladder of a video that would not play.
const REAL = [
    { itag: 315, mimeType: 'video/webm; codecs="vp9"', height: 2160, fps: 60 },
    { itag: 337, mimeType: 'video/webm; codecs="vp9.2"', height: 2160, fps: 60 },
    { itag: 701, mimeType: 'video/mp4; codecs="av01.0.13M.10"', height: 2160, fps: 60 },
    { itag: 308, mimeType: 'video/webm; codecs="vp9"', height: 1440, fps: 60 },
    { itag: 299, mimeType: 'video/mp4; codecs="avc1.64002a"', height: 1080, fps: 60 }
];

// Colour, not depth. A ten-bit encode of BT.709 material is a bigger file of the same
// picture; ten bits on BT.2020 is the HDR master. The set's own app plays the eight-bit
// encode on an SDR video at this size, so an SDR ladder should give exactly that.
const GRADED = { primaries: 'COLOR_PRIMARIES_BT2020', transferCharacteristics: 'COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084' };
const withHdr = REAL.map((f) => (f.itag === 337 || f.itag === 701 ? Object.assign({}, f, { colorInfo: GRADED }) : f));

check('the wider colour is taken where the video has it',
    stream.pick(withHdr, 'video', 2160).itag === 337, 'left HDR on the shelf');
check('a ten-bit encode of ordinary colour is not preferred',
    stream.pick(REAL, 'video', 2160).itag === 315, 'took ten bits for nothing');
check('ten-bit AV1 above thirty is refused even when it is the HDR one',
    stream.pick(withHdr.filter((f) => f.itag !== 337 && f.itag !== 315), 'video', 2160).itag === 308,
    'took the one format that stalls');
check('HDR outranks the container an even tie would have won',
    stream.pick(withHdr.concat([{ itag: 401, mimeType: 'video/mp4; codecs="av01.0.13M.08"', height: 2160, fps: 60 }]),
        'video', 2160).itag === 337, 'took SDR mp4 over HDR');

// Colour has to be stated in the manifest or the set decodes wide-gamut video and shows it
// as if it were ordinary — which looks worse than not offering HDR at all.
const HDR_FORMAT = {
    itag: 337, mimeType: 'video/webm; codecs="vp9.2"', width: 3840, height: 2160, fps: 60,
    bitrate: 30206899, colorInfo: GRADED
};
const SDR_FORMAT = Object.assign({}, HDR_FORMAT, { itag: 315, colorInfo: {
    primaries: 'COLOR_PRIMARIES_BT709', transferCharacteristics: 'COLOR_TRANSFER_CHARACTERISTICS_BT709' } });

const oneSegment = [{ number: 1, startMs: 0, durationMs: 5000, start: 0, end: 1 }];
const shaped = (f) => ({
    id: 'x', videoId: 'y', durationMs: 5000,
    tracks: { video: { kind: 'video', index: oneSegment, format: f }, audio: { kind: 'audio', index: oneSegment, format: f } }
});

const hdrManifest = dash.manifest(shaped(HDR_FORMAT));
check('wide colour is stated as code points',
    hdrManifest.indexOf('cicp:ColourPrimaries" value="9"') !== -1, 'primaries missing');
check('and so is the transfer curve',
    hdrManifest.indexOf('cicp:TransferCharacteristics" value="16"') !== -1, 'transfer missing');
check('ordinary colour is left unsaid',
    dash.manifest(shaped(SDR_FORMAT)).indexOf('SupplementalProperty') === -1, 'stated bt709 needlessly');
check('the page is told the colour so it can correct the panel',
    dash.describe(shaped(HDR_FORMAT)).video.colour.transfer === 'smptest2084', 'colour missing');
check('an eight-bit mp4 still wins an even tie',
    stream.pick(REAL.concat([{ itag: 401, mimeType: 'video/mp4; codecs="av01.0.13M.08"', height: 2160, fps: 60 }]),
        'video', 2160).itag === 401, 'preferred webm needlessly');
// Depth only ever breaks a tie now — ten-bit VP9 plays cleanly here, so it is no reason to
// step down a rung. The long form of the codec string has to be read for it all the same.
check('the long form of vp9 is read for depth',
    stream.pick([
        { itag: 1, mimeType: 'video/webm; codecs="vp09.02.51.10"', height: 2160, fps: 60 },
        { itag: 2, mimeType: 'video/webm; codecs="vp09.00.51.08"', height: 2160, fps: 60 }
    ], 'video', 2160).itag === 2, 'missed the depth in the long form');
check('and depth never costs a rung of picture',
    stream.pick([
        { itag: 1, mimeType: 'video/webm; codecs="vp09.02.51.10"', height: 2160, fps: 60 },
        { itag: 2, mimeType: 'video/webm; codecs="vp09.00.51.08"', height: 1440, fps: 60 }
    ], 'video', 2160).itag === 1, 'stepped down for eight bits');
check('sound is still never taken from webm',
    stream.pick(AUDIO.concat(REAL), 'audio', null, [{ itag: 251, xtags: '' }]).itag === 140, 'took the webm');
