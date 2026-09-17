'use strict';

// A cobalt.js that will not load costs the container route and nothing else.

const postmortem = require('./postmortem.js');

const held = { asked: false, module: null };

const cobaltIfItLoads = () => {
    if (held.asked) return held.module;
    held.asked = true;

    try {
        held.module = require('./cobalt.js');
    } catch (e) {
        postmortem.note('cobalt', `module would not load: ${postmortem.describe(e)}`);
        held.module = null;
    }

    return held.module;
};

module.exports = cobaltIfItLoads;
