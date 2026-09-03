'use strict';

// One place for every port this app binds. The reference hardcoded them at each use site
// and drifted: its injector navigated to localhost:8085 while the DIAL server binds 8095,
// so cast payloads were silently dropped on the CDP path.

module.exports = {
    PROXY: 8099,
    DIAL: 8095,
    SDB: 26101,
    DMP: 8001,
    DEV: 8097
};
