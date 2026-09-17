'use strict';

// A release build carries these defaults and no way to move them.

const flagOverrides = new Map();

const upstream = {
    origin: 'https://www.youtube.com',
    abrThroughService: false,
    onesie: 'auto',
    nativeProxyPatches: true
};

module.exports = { flagOverrides, upstream };
