'use strict';

function boxes(buffer) {
    const found = [];
    const end = buffer.length;
    let at = 0;

    while (at + 8 <= end) {
        const size = buffer.readUInt32BE(at);
        const type = buffer.toString('latin1', at + 4, at + 8);

        // size 0 means "to end of file", 1 means a 64-bit size follows; YouTube serves neither.
        if (size < 8 || at + size > end) break;

        found.push({ type, start: at, end: at + size, body: at + 8 });
        at += size;
    }

    return found;
}

function segmentIndex(buffer) {
    const box = boxes(buffer).filter((entry) => entry.type === 'sidx')[0];
    if (!box) return null;

    const version = buffer.readUInt8(box.body);
    let at = box.body + 4;

    at += 4;
    const timescale = buffer.readUInt32BE(at);
    at += 4;

    if (!timescale) return null;

    // sidx v1 widens earliest_presentation_time and first_offset to 64 bits.
    const wide = version !== 0;
    const wideAt = (start) => (buffer.readUInt32BE(start) * 0x100000000) + buffer.readUInt32BE(start + 4);

    const earliest = wide ? wideAt(at) : buffer.readUInt32BE(at);
    at += wide ? 8 : 4;
    const firstOffset = wide ? wideAt(at) : buffer.readUInt32BE(at);
    at += wide ? 8 : 4;

    at += 2;
    const count = buffer.readUInt16BE(at);
    at += 2;

    if (at + (count * 12) > box.end) return null;

    const segments = [];
    let offset = box.end + firstOffset;
    let time = earliest;

    for (let i = 0; i < count; i += 1) {
        const first = buffer.readUInt32BE(at);
        const size = first & 0x7fffffff;
        const duration = buffer.readUInt32BE(at + 4);
        at += 12;

        // Top bit set means a reference to another index; treating one as media misplaces every
        // following segment.
        if (first >>> 31) return null;

        segments.push({
            number: i + 1,
            startMs: Math.round((time * 1000) / timescale),
            durationMs: Math.round((duration * 1000) / timescale),

            startTicks: time,
            durationTicks: duration,

            start: offset,
            end: offset + size - 1
        });

        offset += size;
        time += duration;
    }

    return { timescale, segments };
}

module.exports = { boxes, segmentIndex };
