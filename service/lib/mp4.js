'use strict';

// Just enough ISO-BMFF to read the `sidx` in YouTube's initialization segments, which lists
// how long every media segment runs and how many bytes it takes.

/** Walks the boxes at the top level. A box that is not all here ends the walk. */
function boxes(buffer) {
    const found = [];
    const end = buffer.length;
    let at = 0;

    while (at + 8 <= end) {
        const size = buffer.readUInt32BE(at);
        const type = buffer.toString('latin1', at + 4, at + 8);

        // 0 means "to the end of the file"; 1 means a 64-bit size follows. Neither appears
        // in what YouTube serves, and guessing at them would be worse than stopping.
        if (size < 8 || at + size > end) break;

        found.push({ type, start: at, end: at + size, body: at + 8 });
        at += size;
    }

    return found;
}

/**
 * The segment index, as a list of segments in order. Sizes are bytes of the file after the
 * index; durations are in the index's own timescale, converted to milliseconds here so a
 * manifest can be written without carrying the timescale around.
 */
function segmentIndex(buffer) {
    const box = boxes(buffer).filter((entry) => entry.type === 'sidx')[0];
    if (!box) return null;

    const version = buffer.readUInt8(box.body);
    let at = box.body + 4;

    at += 4;                                          // reference id
    const timescale = buffer.readUInt32BE(at);
    at += 4;

    // Without one there is nothing to convert durations against, and dividing by it would
    // fill the manifest with infinities.
    if (!timescale) return null;

    // Version 1 widens two fields to 64 bits. Read as two halves rather than as a BigInt:
    // every real value is far below the point where that loses precision, and it asks
    // nothing of the runtime.
    const wide = version !== 0;
    const wideAt = (start) => (buffer.readUInt32BE(start) * 0x100000000) + buffer.readUInt32BE(start + 4);

    const earliest = wide ? wideAt(at) : buffer.readUInt32BE(at);
    at += wide ? 8 : 4;
    const firstOffset = wide ? wideAt(at) : buffer.readUInt32BE(at);
    at += wide ? 8 : 4;

    at += 2;                                          // reserved
    const count = buffer.readUInt16BE(at);
    at += 2;

    // The references have to be inside the box that declares them.
    if (at + (count * 12) > box.end) return null;

    const segments = [];
    let offset = box.end + firstOffset;
    let time = earliest;

    for (let i = 0; i < count; i += 1) {
        const first = buffer.readUInt32BE(at);
        const size = first & 0x7fffffff;
        const duration = buffer.readUInt32BE(at + 4);
        at += 12;

        // A reference to another index rather than to media. YouTube does not use them, and
        // treating one as media would put every following segment at the wrong offset.
        if (first >>> 31) return null;

        segments.push({
            number: i + 1,
            startMs: Math.round((time * 1000) / timescale),
            durationMs: Math.round((duration * 1000) / timescale),
            start: offset,
            end: offset + size - 1
        });

        offset += size;
        time += duration;
    }

    return { timescale, segments };
}

module.exports = { boxes, segmentIndex };
