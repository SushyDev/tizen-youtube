'use strict';

// Everything the container route offers is a convenience laid on a proxy that has to start
// regardless, so a cobalt.js that will not load costs the container and nothing else.
//
// Four files carried their own copy of this, two noting the failure and two swallowing it. Asked
// once and remembered, so the note is written once however many callers there are.

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
