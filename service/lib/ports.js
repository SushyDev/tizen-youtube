'use strict';

// One place for every port this app binds.
//
// The reference hardcoded these at each use site and drifted: its injector
// navigated with `additionalDataUrl=...localhost:8085...` while the standalone
// DIAL server actually binds 8095, so cast payloads were silently dropped on
// the CDP path. Naming them once makes that class of bug impossible.

module.exports = {
    PROXY: 8099,   // MITM proxy used when Developer Mode is off
    DIAL: 8095,    // DIAL server the phone's YouTube app discovers
    SDB: 26101,    // the TV's own SDB daemon
    DMP: 8001      // the TV's Smart View REST API
};
