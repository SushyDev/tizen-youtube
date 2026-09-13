'use strict';

// Node built without ICU has no normalize, and tr46 calls it on every URL node-fetch parses.

// Identity, which is exact for the ASCII hosts this service fetches.
const normalize = function normalize() {
    return String(this);
};

if (typeof String.prototype.normalize !== 'function') {
    Object.defineProperty(String.prototype, 'normalize', { value: normalize, writable: true, configurable: true });
}

module.exports = { normalize };
