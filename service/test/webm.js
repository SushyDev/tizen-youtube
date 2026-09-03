'use strict';

const results = [];
function check(name, ok, detail) {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
}

const webm = require('../lib/webm.js');

function element(id, body) {
    const idBytes = [];
    let value = id;
    while (value > 0) {
        idBytes.unshift(value & 0xff);
        value = Math.floor(value / 256);
    }

    // Sizes here are small enough for the one-byte form, which sets the top bit.
    if (body.length > 0x7e) throw new Error('the fixture needs a longer size form');
    return Buffer.concat([Buffer.from(idBytes), Buffer.from([0x80 | body.length]), body]);
}

function uintBytes(value) {
    const out = [];
    let left = value;
    do {
        out.unshift(left & 0xff);
        left = Math.floor(left / 256);
    } while (left > 0);
    return Buffer.from(out);
}

function cuePoint(timeMs, clusterAt) {
    return element(0xbb, Buffer.concat([
        element(0xb3, uintBytes(timeMs)),
        element(0xb7, Buffer.concat([
            element(0xf7, Buffer.from([1])),
            element(0xf1, uintBytes(clusterAt))
        ]))
    ]));
}

// Cluster positions are relative to the segment's body: an index built against the
// file's start is wrong by exactly the header.
const CUES = [
    { timeMs: 0, at: 400 },
    { timeMs: 5000, at: 1400 },
    { timeMs: 10000, at: 2900 }
];

const info = element(0x1549a966, element(0x2ad7b1, uintBytes(1000000)));
const cues = element(0x1c53bb6b, Buffer.concat(CUES.map((c) => cuePoint(c.timeMs, c.at))));
const segment = element(0x18538067, Buffer.concat([info, cues]));

const headerLength = segment.length - (info.length + cues.length);
const bodyAt = headerLength;

const TOTAL = bodyAt + 4200;
const index = webm.segmentIndex(segment, TOTAL);

check('the index is found', !!index, 'segmentIndex returned nothing');
check('every cluster is a segment', index && index.segments.length === CUES.length,
    index && `${index.segments.length} of ${CUES.length}`);

const first = index && index.segments[0];
check('cluster positions are read relative to the segment body',
    first && first.start === bodyAt + CUES[0].at,
    first && `${first.start} rather than ${bodyAt + CUES[0].at}`);
check('a segment ends where the next begins',
    first && first.end === bodyAt + CUES[1].at - 1,
    first && `${first.end} rather than ${bodyAt + CUES[1].at - 1}`);
check('durations come from the gap between cue times',
    first && first.durationMs === 5000, first && `${first.durationMs}`);

const last = index && index.segments[index.segments.length - 1];
check('the last segment is closed by the file length',
    last && last.end === TOTAL - 1, last && `${last.end} rather than ${TOTAL - 1}`);
check('and is given the length of the one before it',
    last && last.durationMs === 5000, last && `${last.durationMs}`);
check('the initialization segment is everything before the first cluster',
    index && index.init.end === bodyAt + CUES[0].at - 1,
    index && `${index.init.end}`);

const slow = element(0x18538067, Buffer.concat([
    element(0x1549a966, element(0x2ad7b1, uintBytes(2000000))),
    cues
]));
const scaled = webm.segmentIndex(slow, TOTAL);
check('a non-default timecode scale is honoured',
    scaled && scaled.segments[0].durationMs === 10000,
    scaled && `${scaled.segments[0].durationMs} rather than 10000`);

const open = webm.segmentIndex(segment, null);
check('an unknown file length drops the segment it cannot close',
    open && open.segments.length === CUES.length - 1,
    open && `${open.segments.length}`);

check('a buffer that is not WebM is refused rather than fatal',
    webm.segmentIndex(Buffer.alloc(64, 7), 1000) === null, 'returned something');
check('an empty buffer is refused', webm.segmentIndex(Buffer.alloc(0), 1000) === null, 'returned something');

const unknownSize = Buffer.concat([
    Buffer.from([0x18, 0x53, 0x80, 0x67, 0xff]),
    info, cues
]);
const streamed = webm.segmentIndex(unknownSize, 5 + info.length + cues.length + 4200);
check('a segment of unknown length is still walked',
    streamed && streamed.segments.length === CUES.length,
    streamed ? `${streamed.segments.length}` : 'nothing');

const statedAt = segment.length - cues.length;
const byRange = webm.segmentIndex(segment, TOTAL,
    { indexRange: { start: String(statedAt), end: String(segment.length - 1) } });
check('the stated index range finds the same cues',
    byRange && byRange.segments.length === CUES.length
        && byRange.segments[0].start === bodyAt + CUES[0].at,
    byRange ? `${byRange.segments.length} segments` : 'nothing');

check('a stated range beyond what has arrived falls back to searching',
    (() => {
        const found = webm.segmentIndex(segment, TOTAL,
            { indexRange: { start: String(segment.length + 5000), end: String(segment.length + 9000) } });
        return found && found.segments.length === CUES.length;
    })(), 'gave up instead of searching');

if (results.some((ok) => !ok)) process.exitCode = 1;
console.log(`\n${results.filter(Boolean).length}/${results.length} checks`);
