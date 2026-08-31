'use strict';

// What ships to a television. One injection path: CDP over the TV's own sdb daemon.
//
// Everything is in `lib/service.js` so that the development entry can share it without
// this file — the one ncc bundles — ever referring to `dev/`. That is what keeps the
// MITM proxy off the device rather than a flag that could be got wrong at runtime.

require('./lib/service.js').start();
