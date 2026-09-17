'use strict';

const { STAMP } = require('./stamp.js');

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
    model: capability('http://tizen.org/system/model_name'),
    node: process.version,
    pid: process.pid,
    script
});

module.exports = { capability, facts };
