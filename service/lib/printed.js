'use strict';

// What node and libraries print goes nowhere on a TV, so it is noted too.

const util = require('util');

const postmortem = require('./postmortem.js');

const held = { last: '' };

const echo = (what, original) => (...parts) => {
    const text = util.format(...parts);

    if (text !== held.last) {
        held.last = text;
        postmortem.note(what, text);
    }

    return original.apply(console, parts);
};

const attach = () => {
    console.error = echo('error', console.error);
    console.warn = echo('warning', console.warn);

    process.on('warning', (warning) => postmortem.note('warning', `${warning.name}: ${warning.message}`));
};

module.exports = { attach };
