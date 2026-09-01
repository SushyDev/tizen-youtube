'use strict';

// One place for every port this app binds. The reference hardcoded them at each use
// site and drifted: its injector navigated to localhost:8085 while the DIAL server
// binds 8095, so cast payloads were silently dropped on the CDP path.

module.exports = {
    SERVICE: 8099, // the service's own HTTP endpoints, and the dev proxy off-TV
    DIAL: 8095,    // DIAL server the phone's YouTube app discovers
    SDB: 26101,    // the TV's own SDB daemon
    DMP: 8001      // the TV's Smart View REST API
};
