'use strict';

// Node 4.4's Buffer.from rejects Buffer, and alloc and allocUnsafe arrived in 4.5.

const from = (value, encodingOrOffset, length) => {
    if (typeof value === 'number') throw new TypeError('The "value" argument must not be a number');
    if (value instanceof ArrayBuffer) return new Buffer(new Uint8Array(value, encodingOrOffset || 0, length));
    return new Buffer(value, encodingOrOffset);
};

const alloc = (size, fill) => new Buffer(size).fill(fill === undefined ? 0 : fill);

const allocUnsafe = (size) => new Buffer(size);

// Called, not compared: core-js replaces the inherited from.
const fromWorks = () => {
    try {
        const made = Buffer.from('a', 'utf8');
        return Buffer.isBuffer(made) && made[0] === 97;
    } catch (e) {
        return false;
    }
};

// Assigning over an inherited read-only property throws in strict mode.
const install = (name, value) => Object.defineProperty(Buffer, name, { value, writable: true, configurable: true });

if (!fromWorks()) install('from', from);
if (typeof Buffer.alloc !== 'function') install('alloc', alloc);
if (typeof Buffer.allocUnsafe !== 'function') install('allocUnsafe', allocUnsafe);

module.exports = { from, alloc, allocUnsafe };
