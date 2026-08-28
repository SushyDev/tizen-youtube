'use strict';

// One place for every port this app binds. The reference hardcoded them at each use
// site and drifted: its injector navigated to localhost:8085 while the DIAL server
// binds 8095, so cast payloads were silently dropped on the CDP path.

module.exports = {
    PROXY: 8099,   // MITM proxy used when Developer Mode is off
    DIAL: 8095,    // DIAL server the phone's YouTube app discovers
    SDB: 26101,    // the TV's own SDB daemon
    DMP: 8001      // the TV's Smart View REST API
};
