'use strict';

// Which experiment flags the page is served with, and which Origin the service presents to
// Google.
//
// The values ship, because rewriteBody reads them on every page it dresses. The routes that
// *change* them do not — those live in service/dev, so a release build carries the defaults and
// no way to move them.

const flagOverrides = new Map();

const upstream = {
    origin: 'https://www.youtube.com',
    abrThroughService: false,
    onesie: 'auto',
    nativeProxyPatches: true
};

module.exports = { flagOverrides, upstream };
