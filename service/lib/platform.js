'use strict';

const { STAMP } = require('./stamp.js');
const { appVersion } = require('./cobaltConfig.js');

const capability = (key) => {
    try {
        return typeof tizen === 'undefined' ? null : tizen.systeminfo.getCapability(key);
    } catch (e) {
        return null;
    }
};

const facts = (script) => ({
    patch: STAMP,
    tizen: capability('http://tizen.org/feature/platform.version'),
    // Sets agreeing on the Tizen version still differ here.
    firmware: capability('http://tizen.org/system/build.string'),
    built: capability('http://tizen.org/system/build.date'),
    model: capability('http://tizen.org/system/model_name'),
    app: appVersion(),
    node: process.version,
    pid: process.pid,
    script
});

module.exports = { capability, facts };
