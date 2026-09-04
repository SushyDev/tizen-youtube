'use strict';

const journal = require('./journal.js');

const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const CUES = 0x1c53bb6b;
const CUE_POINT = 0xbb;
const CUE_TIME = 0xb3;
const CUE_TRACK_POSITIONS = 0xb7;
const CUE_CLUSTER_POSITION = 0xf1;

// Matroska's default TimecodeScale: nanoseconds per tick, i.e. one millisecond.
const DEFAULT_TIMECODE_SCALE = 1000000;

function vint(buffer, at, keepMarker) {
    if (at >= buffer.length) return null;

    const first = buffer[at];
    if (first === 0) return null;

    let width = 1;
    for (let mask = 0x80; mask && !(first & mask); mask >>= 1) width += 1;
    if (width > 8 || at + width > buffer.length) return null;

    let value = keepMarker ? first : first & (0xff >> width);

    for (let i = 1; i < width; i += 1) {
        if (value > Number.MAX_SAFE_INTEGER / 256) return null;
        value = (value * 256) + buffer[at + i];
    }

    return { value, width };
}

function elements(buffer, from, to) {
    const found = [];
    let at = from;

    while (at < to) {
        const id = vint(buffer, at, true);
        if (!id) break;

        const size = vint(buffer, at + id.width, false);
        if (!size) break;

        const body = at + id.width + size.width;

        // All size bits set means unknown length; nothing can follow such an element.
        const unknown = size.value === (2 ** (7 * size.width)) - 1;
        if (unknown) {
            found.push({ id: id.value, start: at, body, end: to, unknown: true });
            break;
        }

        // Keep an element that runs past what has arrived: the cues sit ahead of the clusters, and
        // truncating here would hide the index behind an unfinished one.
        found.push({ id: id.value, start: at, body, end: Math.min(body + size.value, to) });
        if (body + size.value > to) break;

        at = body + size.value;
    }

    return found;
}

function uint(buffer, element) {
    let value = 0;
    for (let at = element.body; at < element.end; at += 1) {
        if (value > Number.MAX_SAFE_INTEGER / 256) return null;
        value = (value * 256) + buffer[at];
    }
    return value;
}

function bodyOf(buffer, at) {
    const id = vint(buffer, at, true);
    if (!id) return null;

    const size = vint(buffer, at + id.width, false);
    if (!size) return null;

    return at + id.width + size.width;
}

function find(buffer, from, to, id) {
    return elements(buffer, from, to).filter((element) => element.id === id)[0] || null;
}

function segmentIndex(buffer, total, ranges) {
    const segment = find(buffer, 0, buffer.length, SEGMENT);
    if (!segment) return null;

    const inside = elements(buffer, segment.body, Math.min(segment.end, buffer.length));

    const stated = ranges && ranges.indexRange && Number(ranges.indexRange.start) >= 0
        ? { body: null, start: Number(ranges.indexRange.start), end: Number(ranges.indexRange.end) + 1 }
        : null;

    const cues = stated && stated.end <= buffer.length
        ? Object.assign({}, stated, { body: bodyOf(buffer, stated.start) })
        : inside.filter((element) => element.id === CUES)[0];

    if (!cues || cues.body === null) return null;

    const info = inside.filter((element) => element.id === INFO)[0];
    const scaleElement = info && find(buffer, info.body, info.end, TIMECODE_SCALE);
    const scale = (scaleElement && uint(buffer, scaleElement)) || DEFAULT_TIMECODE_SCALE;

    const toMs = (ticks) => Math.round((ticks * scale) / 1000000);

    const points = [];

    elements(buffer, cues.body, cues.end)
        .filter((element) => element.id === CUE_POINT)
        .forEach((point) => {
            const time = find(buffer, point.body, point.end, CUE_TIME);
            const positions = find(buffer, point.body, point.end, CUE_TRACK_POSITIONS);
            if (!time || !positions) return;

            const cluster = find(buffer, positions.body, positions.end, CUE_CLUSTER_POSITION);
            if (!cluster) return;

            const at = uint(buffer, cluster);
            const ticks = uint(buffer, time);
            if (at === null || ticks === null) return;

            // Two cues into the same cluster describe one segment, not two.
            const last = points[points.length - 1];
            if (last && last.start === segment.body + at) return;

            points.push({ startMs: toMs(ticks), ticks, start: segment.body + at });
        });

    if (!points.length) return null;

    const end = Number(total) > 0 ? Number(total) : null;

    const segments = points.map((point, at) => {
        const next = points[at + 1];
        return {
            number: at + 1,
            startMs: point.startMs,
            durationMs: next ? next.startMs - point.startMs : 0,

            // A tick is TimecodeScale nanoseconds, not a millisecond.
            startTicks: point.ticks,
            durationTicks: next ? next.ticks - point.ticks : 0,

            start: point.start,
            end: (next ? next.start : end) - 1
        };
    });

    const usable = segments.filter((one) => Number.isFinite(one.end) && one.end >= one.start);

    if (!usable.length) return null;

    const last = usable[usable.length - 1];
    if (!last.durationMs && usable.length > 1) {
        last.durationMs = usable[usable.length - 2].durationMs;
        last.durationTicks = usable[usable.length - 2].durationTicks;
    }

    return {
        init: { start: 0, end: points[0].start - 1 },
        segments: usable,
        timescale: Math.round(1000000000 / scale),

        cues: { start: cues.start, end: cues.end - 1 },
        setup: { start: 0, end: cues.start - 1 }
    };
}

module.exports = { segmentIndex };
