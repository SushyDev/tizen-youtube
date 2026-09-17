'use strict';

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;

// How far from the end the record can sit: its own size plus the longest comment.
const TAIL = END_SIZE + 0xFFFF;

// Searched backwards, past any trailing comment.
const endOf = (tail) => {
    const at = Array.from({ length: Math.max(0, tail.length - END_SIZE + 1) }, (_, back) => tail.length - END_SIZE - back)
        .find((offset) => tail.readUInt32LE(offset) === END_SIGNATURE);

    if (at === undefined) throw new Error('zip: no end record');

    return { count: tail.readUInt16LE(at + 10), size: tail.readUInt32LE(at + 12), offset: tail.readUInt32LE(at + 16) };
};

const entryAt = (central, at) => {
    if (central.readUInt32LE(at) !== CENTRAL_SIGNATURE) throw new Error('zip: broken central directory');

    const nameLength = central.readUInt16LE(at + 28);
    const skipped = nameLength + central.readUInt16LE(at + 30) + central.readUInt16LE(at + 32);

    return {
        entry: {
            name: central.toString('utf8', at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLength),
            method: central.readUInt16LE(at + 10),
            crc: central.readUInt32LE(at + 16),
            packed: central.readUInt32LE(at + 20),
            size: central.readUInt32LE(at + 24),
            local: central.readUInt32LE(at + 42)
        },
        next: at + CENTRAL_SIZE + skipped
    };
};

const entriesOf = (central, count) => Array.from({ length: count }).reduce((found) => {
    const read = entryAt(central, found.at);
    return { at: read.next, list: found.list.concat([read.entry]) };
}, { at: 0, list: [] }).list;

const dataOf = (buffer, at, entry) => {
    if (buffer.readUInt32LE(at) !== LOCAL_SIGNATURE) throw new Error(`zip: no local header for ${entry.name}`);

    const start = at + LOCAL_SIZE + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
    return buffer.slice(start, start + entry.packed);
};

module.exports = { TAIL, endOf, entriesOf, dataOf };
