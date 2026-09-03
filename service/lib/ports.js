'use strict';

// One place for every port this app binds. The reference hardcoded them at each use site
// and drifted: it navigated to localhost:8085 while the DIAL server binds 8095, so cast
// payloads were silently dropped.

module.exports = {
    PROXY: 8099,
    DIAL: 8095,
    DEV: 8097
};
