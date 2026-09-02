'use strict';

// Just enough Matroska to read the cues in YouTube's WebM initialization segments.
//
// The MP4 files carry a `sidx` listing every segment; WebM carries a Cues element listing
// every cluster instead. Same information in a different shape, so this returns exactly
// what `mp4.segmentIndex` does and everything downstream stays container-agnostic.
//
// This exists because at 2160p60 YouTube offers only AV1 in MP4, and this hardware cannot
// hold ten-bit AV1 at that size — while its VP9 path plays 4K60 without dropping a frame,
// which is what the set's own YouTube app uses. VP9 is only ever offered in WebM.

const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const CUES = 0x1c53bb6b;
const CUE_POINT = 0xbb;
const CUE_TIME = 0xb3;
const CUE_TRACK_POSITIONS = 0xb7;
const CUE_CLUSTER_POSITION = 0xf1;

// Matroska's default: timecodes are in units of a million nanoseconds, which is a
// millisecond. YouTube uses the default, but a file may say otherwise and then every
// duration would be wrong by a factor nobody would notice until seeking.
const DEFAULT_TIMECODE_SCALE = 1000000;

/**
 * An EBML variable-length integer.
 *
 * The first byte's leading zeros say how many bytes it occupies. An id keeps the marker
 * bit, because that is part of how ids are written down; a size drops it, because there
 * the bit is only a length marker.
 */
function vint(buffer, at, keepMarker) {
    if (at >= buffer.length) return null;

    const first = buffer[at];
    if (first === 0) return null;

    let width = 1;
    for (let mask = 0x80; mask && !(first & mask); mask >>= 1) width += 1;
    if (width > 8 || at + width > buffer.length) return null;

    let value = keepMarker ? first : first & (0xff >> width);

    for (let i = 1; i < width; i += 1) {
        // Beyond this a number stops being exact, and a silently wrong offset is worse
        // than refusing to read the file.
        if (value > Number.MAX_SAFE_INTEGER / 256) return null;
        value = (value * 256) + buffer[at + i];
    }

    return { value, width };
}

/** The elements laid out between two offsets, without descending into them. */
function elements(buffer, from, to) {
    const found = [];
    let at = from;

    while (at < to) {
        const id = vint(buffer, at, true);
        if (!id) break;

        const size = vint(buffer, at + id.width, false);
        if (!size) break;

        const body = at + id.width + size.width;

        // Every size bit set means "length unknown", which is how a segment written as a
        // stream declares itself. It runs to the end of what there is — and since nothing
        // can follow it, the walk stops after it rather than trying to read past it.
        const unknown = size.value === (2 ** (7 * size.width)) - 1;
        if (unknown) {
            found.push({ id: id.value, start: at, body, end: to, unknown: true });
            break;
        }

        // An element larger than what has arrived is still where it says it is: the cues
        // sit near the front and the clusters after them, so truncating here would hide
        // the index behind the first cluster that had not finished downloading.
        found.push({ id: id.value, start: at, body, end: Math.min(body + size.value, to) });
        if (body + size.value > to) break;

        at = body + size.value;
    }

    return found;
}

/** An unsigned integer element, which is however many bytes it says it is. */
function uint(buffer, element) {
    let value = 0;
    for (let at = element.body; at < element.end; at += 1) {
        if (value > Number.MAX_SAFE_INTEGER / 256) return null;
        value = (value * 256) + buffer[at];
    }
    return value;
}

/** Where an element's body starts, given where the element itself does. */
function bodyOf(buffer, at) {
    const id = vint(buffer, at, true);
    if (!id) return null;

    const size = vint(buffer, at + id.width, false);
    if (!size) return null;

    return at + id.width + size.width;
}

/** Depth-first search for one element id, which is enough for the few needed here. */
function find(buffer, from, to, id) {
    return elements(buffer, from, to).filter((element) => element.id === id)[0] || null;
}

/**
 * The segment index, in the same shape `mp4.segmentIndex` returns.
 *
 * Cluster positions are written relative to the start of the segment's body rather than to
 * the file, so the segment's own header has to be found first. `total` is the file's length,
 * which is what closes the last cluster — the cues say where each one begins and nothing
 * says where the last one ends.
 */
function segmentIndex(buffer, total, ranges) {
    const segment = find(buffer, 0, buffer.length, SEGMENT);
    if (!segment) return null;

    const inside = elements(buffer, segment.body, Math.min(segment.end, buffer.length));

    // The player response says where the cues are, which saves walking past a cluster to
    // reach them and works even when an element between here and there is truncated.
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

    // Nanoseconds per tick, to milliseconds.
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
            const startMs = toMs(uint(buffer, time));
            if (at === null || startMs === null) return;

            // Two cues into the same cluster describe one segment, not two.
            const last = points[points.length - 1];
            if (last && last.start === segment.body + at) return;

            points.push({ startMs, start: segment.body + at });
        });

    if (!points.length) return null;

    const end = Number(total) > 0 ? Number(total) : null;

    const segments = points.map((point, at) => {
        const next = points[at + 1];
        return {
            number: at + 1,
            startMs: point.startMs,
            durationMs: next ? next.startMs - point.startMs : 0,
            start: point.start,
            end: (next ? next.start : end) - 1
        };
    });

    // The last cluster's length is only known from the file's own length. Without it its
    // end is not a number, and a segment that cannot be asked for is dropped rather than
    // served as a range running past the end of the file.
    const usable = segments.filter((one) => Number.isFinite(one.end) && one.end >= one.start);

    if (!usable.length) return null;

    // The last segment's duration cannot be read from the next one's start.
    const last = usable[usable.length - 1];
    if (!last.durationMs && usable.length > 1) {
        last.durationMs = usable[usable.length - 2].durationMs;
    }

    return { init: { start: 0, end: points[0].start - 1 }, segments: usable };
}

module.exports = { elements, segmentIndex, vint };
