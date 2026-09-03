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

// Either side of the window, which reaches KEEP_BEHIND back from where the player is: at
// twenty that is everything from five. Segment 2 is outside it and 18 is inside, and the
// one inside has to stay — a player that asks again for something it has just watched, after
// a stall or an eviction of its own, is answered from here rather than sending the download
// backwards for it.
back.have = new Set([0, 2, 18, 19, 20, 100, 101]);
back.forgetBehind().then(function () {
    check('the initialization segment is never dropped', back.have.has(0), 'dropped it');
    check('what is watched and behind the window goes', !back.have.has(2), 'kept it');
    check('and what is just behind the player is kept, so it is not fetched twice',
        back.have.has(18), 'dropped something the player may ask for again');
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

// Nothing is refused for its bit depth. Ten-bit AV1 was held back here for a while on a
// measurement taken while seeking was broken for the container it was compared against.
const TEN_BIT = [
    { itag: 701, mimeType: 'video/mp4; codecs="av01.0.13M.10"', height: 2160, fps: 60 },
    { itag: 700, mimeType: 'video/mp4; codecs="av01.0.12M.10"', height: 1440, fps: 60 },
    { itag: 299, mimeType: 'video/mp4; codecs="avc1.64002a"', height: 1080, fps: 60 }
];

check('the tallest picture is taken whatever its depth',
    stream.pick(TEN_BIT, 'video', 2160).itag === 701, 'stepped down for bit depth');
check('eight bits at the top is still the tallest picture',
    stream.pick(VIDEO.concat(AUDIO), 'video', 2160).itag === 401, 'stepped down needlessly');
check('depth still breaks a tie at the same size',
    stream.pick([
        { itag: 701, mimeType: 'video/mp4; codecs="av01.0.13M.10"', height: 2160, fps: 60 },
        { itag: 401, mimeType: 'video/mp4; codecs="av01.0.13M.08"', height: 2160, fps: 60 }
    ], 'video', 2160).itag === 401, 'ignored the depth on a tie');

// The real ladder of a 2160p60 HDR video, which is where the interesting choices are.
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

// AV1 is what puts this panel into HDR — VP9 profile 2 decodes and the set stays in
// standard range — and MP4 wins the tie between two equally graded pictures anyway.
check('the wider colour is taken where the display can show it',
    stream.pick(withHdr, 'video', 2160, null, undefined, true).itag === 701, 'left HDR on the shelf');
check('and refused where the display cannot',
    stream.pick(withHdr, 'video', 2160, null, undefined, false).itag === 315,
    'spent the bitrate on a picture that would be flattened');
check('a ten-bit encode of ordinary colour is not preferred',
    stream.pick(REAL, 'video', 2160).itag === 315, 'took ten bits for nothing');
check('HDR outranks the container an even tie would have won',
    stream.pick(withHdr.concat([{ itag: 401, mimeType: 'video/mp4; codecs="av01.0.13M.08"', height: 2160, fps: 60 }]),
        'video', 2160, null, undefined, true).itag === 701, 'took SDR mp4 over HDR');

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
    dash.describe(shaped(HDR_FORMAT)).video.colour.transfer === 'smpte2084 (PQ)', 'colour missing');
// Two tracks joined into one file. Built from the smallest boxes that carry the fields the
// join rewrites, because what is being checked is the renumbering and nothing else.
const mux = require('../lib/mux.js');

const atom = (type, body) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(body.length + 8, 0);
    header.write(type, 4, 'latin1');
    return Buffer.concat([header, body]);
};

const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32BE(value, 0); return b; };

// version 0: creation, modification, track_ID, reserved, duration
const tkhd = (id) => atom('tkhd', Buffer.concat([u32(0), u32(0), u32(0), u32(id), u32(0), u32(0)]));
const trex = (id) => atom('trex', Buffer.concat([u32(0), u32(id), u32(1), u32(0), u32(0), u32(0)]));
const mvhd = () => atom('mvhd', Buffer.concat([u32(0), Buffer.alloc(96)]));

const initFor = (id) => Buffer.concat([
    atom('ftyp', Buffer.from('isom')),
    atom('moov', Buffer.concat([mvhd(), atom('trak', tkhd(id)), atom('mvex', trex(id))]))
]);

// Segments as the index gives them: a byte range and a span of time.
const seg = (number, startMs, durationMs, start, end) => ({ number, startMs, durationMs, start, end });

const videoIndex = [seg(1, 0, 5000, 0, 999), seg(2, 5000, 5000, 1000, 2999)];
const audioIndex = [seg(1, 0, 4000, 0, 99), seg(2, 4000, 4000, 100, 299), seg(3, 8000, 4000, 300, 349)];

const shape = mux.describeFile(initFor(1), initFor(1), videoIndex, audioIndex);
const inMoov = require('../lib/mp4.js').boxes(shape.head)
    .filter((one) => one.type === 'moov')
    .map((one) => require('../lib/mp4.js').boxes(shape.head.subarray(one.body, one.end)))[0] || [];

check('joining two tracks keeps the file type',
    require('../lib/mp4.js').boxes(shape.head).some((one) => one.type === 'ftyp'), 'lost the ftyp');
check('and produces two tracks where there was one each',
    inMoov.filter((one) => one.type === 'trak').length === 2, 'wrong number of traks');
check('the sound is renumbered so the two do not collide',
    shape.head.indexOf(Buffer.from([0, 0, 0, mux.AUDIO_TRACK])) !== -1, 'no track two anywhere');
check('the head carries a segment index, so a seek can name a moment',
    require('../lib/mp4.js').boxes(shape.head).some((one) => one.type === 'sidx'), 'no sidx');

// The sound belonging to a stretch of picture goes in front of it, and sound that outlasts
// the last picture joins the last group rather than claiming a span of time of its own.
// Ordered by when each moment happens. a2 begins at 4s, inside v1's 0-5s span but after
// v1 begins, so it follows the picture rather than being written in front of it.
check('fragments are written in the order their moments happen',
    shape.groups.map((one) => one.parts.map((part) => part.kind[0] + part.number).join('')).join(' ')
        === 'a1v1a2 v2a3', 'ordered wrongly');
check('the file knows its own length before anything is fetched',
    shape.total === shape.head.length + 1000 + 2000 + 100 + 200 + 50, 'wrong total');
check('and where every fragment lands in it',
    shape.parts[0].offset === shape.head.length
        && shape.parts[1].offset === shape.head.length + 100, 'wrong offsets');

// Without a duration the element reports NaN, offers nothing as seekable, and answers a
// seek by guessing a byte offset from a length it does not have.
check('the file says how long it runs, for as long as both tracks have something',
    shape.durationMs === 10000, 'wrong duration');
check('and says it where a fragmented file says it',
    require('../lib/mp4.js').boxes(shape.head)
        .filter((one) => one.type === 'moov')
        .map((one) => require('../lib/mp4.js').boxes(shape.head.subarray(one.body, one.end)))[0]
        .some((one) => one.type === 'mvex'), 'no mvex to carry it');

// version+flags, then track_ID: what a fragment carries and what has to be rewritten.
const fragment = Buffer.concat([
    atom('moof', Buffer.concat([
        atom('mfhd', Buffer.concat([u32(0), u32(1)])),
        atom('traf', atom('tfhd', Buffer.concat([u32(0), u32(1)])))
    ])),
    atom('mdat', Buffer.from('media'))
]);

const moved = mux.retrack(fragment, mux.AUDIO_TRACK, 7);

check('a fragment keeps its size when it is renumbered',
    moved.length === fragment.length, 'the offsets inside it would have moved');
check('and carries the track it was given',
    moved.readUInt32BE(moved.indexOf(Buffer.from('tfhd')) + 4 + 4) === mux.AUDIO_TRACK, 'not renumbered');
check('and its place in the sequence',
    moved.readUInt32BE(moved.indexOf(Buffer.from('mfhd')) + 4 + 4) === 7, 'sequence not written');

const asRange = (header, total) => {
    const read = mux.rangeOf(header, total);
    return read ? `${read.from}-${read.to}${read.open ? ' open' : ''}` : String(read);
};

check('a range is read as the bytes it asks for',
    asRange('bytes=100-199', 1000) === '100-199', 'misread');
check('a range naming only a start is open, and answered with what is sensible',
    asRange('bytes=900-', 1000) === '900-999 open', 'misread');
check('a suffix range counts back from the end and is not open',
    asRange('bytes=-100', 1000) === '900-999', 'misread');
check('a range past the end is refused rather than served',
    mux.rangeOf('bytes=2000-', 1000).unsatisfiable === true, 'served nonsense');
check('no range at all means the whole file',
    mux.rangeOf(undefined, 1000) === null && mux.rangeOf('bytes=-', 1000) === null, 'invented a range');

// The same session, described the other way. Both descriptions point at the same files, so
// what is checked here is that the description is well-formed and says the same things.
const hlsMaster = require('../lib/hls.js').master(shaped(HDR_FORMAT));
const hlsMedia = require('../lib/hls.js').media(shaped(HDR_FORMAT), 'video');

check('the master playlist names the audio and the video',
    hlsMaster.indexOf('#EXT-X-MEDIA:TYPE=AUDIO') !== -1 && /\nvideo\.m3u8/.test(hlsMaster),
    'a track is missing');
check('wide colour is stated as a video range',
    hlsMaster.indexOf('VIDEO-RANGE=PQ') !== -1, 'said the wrong range');
check('ordinary colour is stated as SDR',
    require('../lib/hls.js').master(shaped(SDR_FORMAT)).indexOf('VIDEO-RANGE=SDR') !== -1,
    'said the wrong range');
check('the media playlist names the initialisation segment',
    hlsMedia.indexOf('#EXT-X-MAP:URI="video/init.mp4"') !== -1, 'no map');
check('and every segment after it, ending',
    /#EXTINF:[\d.]+,\nvideo\/\d+\.m4s/.test(hlsMedia) && hlsMedia.indexOf('#EXT-X-ENDLIST') !== -1,
    'not a complete vod playlist');
check('the target duration covers the longest segment',
    /#EXT-X-TARGETDURATION:(\d+)/.exec(hlsMedia)[1] >= 5, 'too short to be legal');

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

// A stream that begins partway through opens with the file's header again, and that header
// is already on disk. Recognising it used to mean reading MP4 boxes whatever the container
// was — which, fed WebM, found nothing and cut no segments at all, so every part-watched
// video on VP9 downloaded for ever and never played.
const EBML_HEADER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
const FTYP = box('ftyp', Buffer.alloc(8, 1));

check('an EBML header is not read as an MP4 box',
    mp4.boxes(EBML_HEADER).length === 0, 'found boxes in WebM');
check('and the EBML signature is what marks it',
    EBML_HEADER.readUInt32BE(0) === 0x1a45dfa3, 'signature moved');
check('an MP4 header is still recognised by its first box',
    mp4.boxes(FTYP)[0].type === 'ftyp', 'ftyp not found');

// Both tracks belong to one position. The player asks for one segment at a time, so a
// resumed video moves the picture and says nothing about the sound — which then grinds
// forward from the start while the player waits for audio it will not have for minutes.
const longVideo = Array.from({ length: 720 }, (_, at) => ({
    number: at + 1, startMs: at * 5000, durationMs: 5000, start: 0, end: 1
}));
const longAudio = Array.from({ length: 360 }, (_, at) => ({
    number: at + 1, startMs: at * 10000, durationMs: 10000, start: 0, end: 1
}));

const paired = () => {
    const video = new stream.Track('video', { itag: 337, mimeType: 'video/webm; codecs="vp9"' }, dir);
    const audio = new stream.Track('audio', { itag: 140, mimeType: 'audio/mp4' }, dir);
    video.index = longVideo;
    audio.index = longAudio;
    video.next = 1;
    audio.next = 1;
    return { tracks: { video, audio } };
};

// Resuming an hour in: video segment 721 would be 3600s, so 361 is 1800s — segment 181 of
// the audio, which is nowhere near where the sound has reached.
const far = paired();
stream.align(far, 'video', 361);
check('sound is moved to where the picture went',
    far.tracks.audio.wanted === 181, `wanted ${far.tracks.audio.wanted}`);
check('and the download is sent there rather than crawling',
    far.tracks.audio.restartAt === 181, `restartAt ${far.tracks.audio.restartAt}`);

// A step of one segment is ordinary playback and must not restart anything.
const near = paired();
near.tracks.audio.next = 3;
stream.align(near, 'video', 5);
check('ordinary playback does not move the other track',
    near.tracks.audio.restartAt === null, `restartAt ${near.tracks.audio.restartAt}`);

// Nor should a segment already on disk.
const held = paired();
held.tracks.audio.next = 400;
held.tracks.audio.have.add(181);
stream.align(held, 'video', 361);
check('a segment already held is not fetched again',
    held.tracks.audio.restartAt === null, `restartAt ${held.tracks.audio.restartAt}`);

check('aligning against a segment that does not exist is harmless',
    (() => { const s2 = paired(); stream.align(s2, 'video', 99999); return s2.tracks.audio.restartAt === null; })(),
    'moved the other track anyway');
