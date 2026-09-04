'use strict';

const { mkdtempSync, existsSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const results = [];
function check(name, ok, detail) {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
}

const dir = mkdtempSync(join(tmpdir(), 'tube-segments-'));
process.env.TUBE_MEDIA_DIR = join(dir, 'media');

// Run twice: once as it ships, once with TUBE_MEMORY_BUDGET=0. Both must serve the same bytes.
const ONLY_DISK = process.env.TUBE_MEMORY_BUDGET === '0';

const mp4 = require('../lib/mp4.js');
const stream = require('../lib/stream.js');

function box(type, body) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length + 8, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body]);
}

function initSegment(segments, timescale) {
    const references = Buffer.concat(segments.map(({ size, duration }) => {
        const entry = Buffer.alloc(12);
        entry.writeUInt32BE(size, 0);
        entry.writeUInt32BE(duration * timescale / 1000, 4);
        entry.writeUInt32BE(0x90000000, 8);
        return entry;
    }));

    const header = Buffer.alloc(20);
    header.writeUInt32BE(0, 0);
    header.writeUInt32BE(1, 4);
    header.writeUInt32BE(timescale, 8);
    header.writeUInt32BE(0, 12);
    header.writeUInt32BE(0, 16);
    const counted = Buffer.alloc(4);
    counted.writeUInt16BE(0, 0);
    counted.writeUInt16BE(segments.length, 2);

    return Buffer.concat([
        box('ftyp', Buffer.alloc(12, 1)),
        box('moov', Buffer.alloc(40, 2)),
        box('sidx', Buffer.concat([header, counted, references]))
    ]);
}

const SHAPE = [{ size: 1000, duration: 5000 }, { size: 2000, duration: 6000 }, { size: 1500, duration: 5000 }];
const init = initSegment(SHAPE, 1000);

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

const DUBBED = [
    { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, xtags: 'lang-ja' },
    { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 129000, xtags: 'lang-en' }
];

const english = stream.pick(DUBBED, 'audio', null, [], 'lang-en');
check('the language the player names is the one fetched',
    english && english.xtags === 'lang-en', english && `xtags ${english.xtags}`);

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

const seeking = new stream.Track('video', { itag: 401, xtags: '' }, dir);
seeking.index = index.segments;
seeking.init = { start: 0, end: init.length - 1 };
seeking.next = 1;

seeking.running = true;

check('a segment just ahead is waited for', seeking.reachable(2), 'would restart');
check('and the same segment is not waited for once nothing is fetching',
    !Object.assign(Object.create(Object.getPrototypeOf(seeking)), seeking, { running: false }).reachable(2),
    'waited for a segment nobody is fetching');
check('a segment far ahead is not', !seeking.reachable(400), 'would wait');

seeking.reach(3).catch(function () { });
check('asking for one nearby does not move the stream', seeking.restartAt === null,
    `restartAt ${seeking.restartAt}`);

seeking.reach(400).catch(function () { });
check('asking for one far off moves the stream there', seeking.restartAt === 400,
    `restartAt ${seeking.restartAt}`);

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
    mine && mine.downloadedSegments.length === before.length + 1 && other && other.downloadedSegments.length === 0,
    'the wrong track was claimed for');

// The index does not number the init segment; leave segment zero out of the claim and the
// server refuses the stream with `Missing segments: [0]`.
check('the initialization segment is named in the claim',
    mine && mine.downloadedSegments[0][0] === 0,
    'segment zero is missing, which the stream is refused for');
check('both formats are named, which the restore requires',
    claim && claim.initializedFormats.length === 2, 'a format is missing');
check('a claim cannot be made before both formats are known',
    stream.stateFor(seeking, new Map(), 3, 60000) === null, 'made one anyway');

const ahead = new stream.Track('video', { itag: 1 }, dir);

check('the download runs while the window has room', !ahead.satisfied, 'stopped at once');

ahead.grow(1, Buffer.alloc(stream.WINDOW_BYTES));
check('and holds back once the window is full', ahead.satisfied, 'kept fetching');

ahead.forget(1);
check('and resumes once what it held is released', !ahead.satisfied, 'still holding back');

check('no claim can be built for the first segment',
    stream.stateFor(seeking, records, index.segments[0].number, 60000) === null, 'built one');

const back = new stream.Track('video', { itag: 1 }, dir);
const piece = Math.ceil(stream.TAIL_BYTES / 2);

[0, 2, 18, 19, 20, 100, 101].forEach((number) => back.grow(number, Buffer.alloc(piece)));
back.next = 21;

// Read before want(), which releases what is behind.
const holding = back.bytesHeld;
back.want(20);

check('the position follows a seek backwards', back.wanted === 20, `wanted ${back.wanted}`);

back.forgetBehind().then(function () {
    check('the initialization segment is never dropped', back.parts.has(0), 'dropped it');
    check('and what is just behind the player is kept, so it is not fetched twice',
        back.parts.has(19), 'dropped something the player may ask for again');
    check('where the player is stays', back.parts.has(20), 'dropped the window');
    check('what is watched and further back than the tail goes', !back.parts.has(2), 'kept it');
    check('what a seek stranded ahead goes too',
        !back.parts.has(100) && !back.parts.has(101), 'kept stale segments');
    check('and the bytes go with them', back.bytesHeld < holding, 'still accounted for');
});

check('a partial initialization segment yields nothing',
    mp4.segmentIndex(init.subarray(0, init.length - 4)) === null, 'parsed anyway');
check('bytes that are not an initialization segment yield nothing',
    mp4.segmentIndex(Buffer.alloc(64)) === null, 'parsed anyway');

async function cutting(name, chunks) {
    const track = new stream.Track('video', { itag: 1, mimeType: 'video/mp4' }, join(dir, name));
    require('fs').mkdirSync(track.dir, { recursive: true });

    const reader = (function* () { for (const chunk of chunks) yield chunk; })();

    const formats = { video: { itag: 1, mimeType: 'video/mp4' }, audio: { itag: 2, mimeType: 'audio/mp4' } };

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

        const wrote = await track.bytes(0);
        check(`${name}: the initialization segment is the head of the file`,
            wrote && wrote.equals(init), 'differs');

        const one = await track.bytes(1);
        check(`${name}: segment one is its own bytes`, one && one.equals(media[0]), 'differs');

        check(`${name}: segment one is held in memory, not written`,
            track.parts.has(1) && !existsSync(track.file(1)), 'not held');

        const partial = new stream.Track('video', { mimeType: 'video/mp4' }, join(dir, 'partial'));
        partial.grow(7, Buffer.from('abcd'));
        const early = partial.head(7, 4);
        partial.grow(7, Buffer.from('efgh'));
        partial.settle(7);
        check(`${name}: a reader is answered before the segment completes`,
            (await early).equals(Buffer.from('abcd')), 'wrong bytes');
        check(`${name}: the rest arrives after`,
            (await partial.bytes(7)).equals(Buffer.from('abcdefgh')), 'wrong bytes');

        const before = track.bytesHeld;
        track.forget(1);
        check(`${name}: forgetting segment one releases it`,
            !track.parts.has(1) && !track.have.has(1) && track.bytesHeld < before, 'still there');
    }

    console.log(`\n${ONLY_DISK ? 'disk' : 'memory'}: ` +
        `${results.filter(Boolean).length}/${results.length} checks passed.`);
    process.exit(results.every(Boolean) ? 0 : 1);
})();

const dash = require('../lib/dash.js');

const evenly = Array.from({ length: 500 }, (_, at) => ({
    number: at + 1, startMs: at * 5000, durationMs: 5000, start: 0, end: 1
}));

const format = { itag: 1, mimeType: 'video/mp4; codecs="av01"', width: 3840, height: 2160, fps: 60, bitrate: 1 };
const asSession = (index, timescale) => ({
    id: 'x', videoId: 'y', durationMs: 2500000,
    tracks: {
        video: { kind: 'video', index, format, timescale },
        audio: { kind: 'audio', index, format, timescale }
    }
});

// Timeline must be in media ticks, matching the decode times inside the fragments; a
// millisecond timeline only breaks at a seek.
const ticking = Array.from({ length: 4 }, function (_, at) {
    return {
        number: at + 1,
        startMs: Math.round((at * 90000 * 1000) / 90000),
        durationMs: 1000,
        startTicks: at * 90000,
        durationTicks: 90000,
        start: 0,
        end: 1
    };
});

const ticked = dash.manifest(asSession(ticking, 90000));

check('the timeline is written in the media clock, not in milliseconds',
    ticked.indexOf('d="90000"') !== -1, 'durations were converted to milliseconds');
check('and the manifest declares that clock',
    ticked.indexOf('timescale="90000"') !== -1, 'the timescale still claims milliseconds');

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

const REAL = [
    { itag: 315, mimeType: 'video/webm; codecs="vp9"', height: 2160, fps: 60 },
    { itag: 337, mimeType: 'video/webm; codecs="vp9.2"', height: 2160, fps: 60 },
    { itag: 701, mimeType: 'video/mp4; codecs="av01.0.13M.10"', height: 2160, fps: 60 },
    { itag: 308, mimeType: 'video/webm; codecs="vp9"', height: 1440, fps: 60 },
    { itag: 299, mimeType: 'video/mp4; codecs="avc1.64002a"', height: 1080, fps: 60 }
];

const GRADED = { primaries: 'COLOR_PRIMARIES_BT2020', transferCharacteristics: 'COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084' };
const withHdr = REAL.map((f) => (f.itag === 337 || f.itag === 701 ? Object.assign({}, f, { colorInfo: GRADED }) : f));

check('the wider colour is taken where the display can show it',
    stream.pick(withHdr, 'video', 2160, null, undefined, true).itag === 701, 'left HDR on the shelf');
check('and refused where the display cannot',
    stream.pick(withHdr, 'video', 2160, null, undefined, false).itag === 315,
    'spent the bitrate on a picture that would be flattened');
check('MP4 is taken over WebM even when its depth buys nothing, because seeking depends on it',
    stream.pick(REAL, 'video', 2160).itag === 701, 'took a container that cannot be seeked in');
check('HDR outranks the container an even tie would have won',
    stream.pick(withHdr.concat([{ itag: 401, mimeType: 'video/mp4; codecs="av01.0.13M.08"', height: 2160, fps: 60 }]),
        'video', 2160, null, undefined, true).itag === 701, 'took SDR mp4 over HDR');

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
const mux = require('../lib/mux.js');

const atom = (type, body) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(body.length + 8, 0);
    header.write(type, 4, 'latin1');
    return Buffer.concat([header, body]);
};

const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32BE(value, 0); return b; };

const tkhd = (id) => atom('tkhd', Buffer.concat([u32(0), u32(0), u32(0), u32(id), u32(0), u32(0)]));
const trex = (id) => atom('trex', Buffer.concat([u32(0), u32(id), u32(1), u32(0), u32(0), u32(0)]));
const mvhd = () => atom('mvhd', Buffer.concat([u32(0), Buffer.alloc(96)]));

const initFor = (id) => Buffer.concat([
    atom('ftyp', Buffer.from('isom')),
    atom('moov', Buffer.concat([mvhd(), atom('trak', tkhd(id)), atom('mvex', trex(id))]))
]);

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

check('fragments are written in the order their moments happen',
    shape.groups.map((one) => one.parts.map((part) => part.kind[0] + part.number).join('')).join(' ')
        === 'a1v1a2 v2a3', 'ordered wrongly');
check('the file knows its own length before anything is fetched',
    shape.total === shape.head.length + 1000 + 2000 + 100 + 200 + 50, 'wrong total');
check('and where every fragment lands in it',
    shape.parts[0].offset === shape.head.length
        && shape.parts[1].offset === shape.head.length + 100, 'wrong offsets');

check('the file says how long it runs, for as long as both tracks have something',
    shape.durationMs === 10000, 'wrong duration');
check('and says it where a fragmented file says it',
    require('../lib/mp4.js').boxes(shape.head)
        .filter((one) => one.type === 'moov')
        .map((one) => require('../lib/mp4.js').boxes(shape.head.subarray(one.body, one.end)))[0]
        .some((one) => one.type === 'mvex'), 'no mvex to carry it');

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

check('an eight-bit mp4 still wins an even tie',
    stream.pick(REAL.concat([{ itag: 401, mimeType: 'video/mp4; codecs="av01.0.13M.08"', height: 2160, fps: 60 }]),
        'video', 2160).itag === 401, 'preferred webm needlessly');
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

const EBML_HEADER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
const FTYP = box('ftyp', Buffer.alloc(8, 1));

check('an EBML header is not read as an MP4 box',
    mp4.boxes(EBML_HEADER).length === 0, 'found boxes in WebM');
check('and the EBML signature is what marks it',
    EBML_HEADER.readUInt32BE(0) === 0x1a45dfa3, 'signature moved');
check('an MP4 header is still recognised by its first box',
    mp4.boxes(FTYP)[0].type === 'ftyp', 'ftyp not found');

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

const far = paired();
stream.align(far, 'video', 361);
check('sound is moved to where the picture went',
    far.tracks.audio.wanted === 181, `wanted ${far.tracks.audio.wanted}`);
check('and the download is sent there rather than crawling',
    far.tracks.audio.restartAt === 181, `restartAt ${far.tracks.audio.restartAt}`);

const near = paired();
near.tracks.audio.next = 3;
near.tracks.audio.running = true;
stream.align(near, 'video', 5);
check('ordinary playback does not move the other track',
    near.tracks.audio.restartAt === null, `restartAt ${near.tracks.audio.restartAt}`);

const held = paired();
held.tracks.audio.next = 400;
held.tracks.audio.have.add(181);
stream.align(held, 'video', 361);
check('a segment already held is not fetched again',
    held.tracks.audio.restartAt === null, `restartAt ${held.tracks.audio.restartAt}`);

check('aligning against a segment that does not exist is harmless',
    (() => { const s2 = paired(); stream.align(s2, 'video', 99999); return s2.tracks.audio.restartAt === null; })(),
    'moved the other track anyway');
