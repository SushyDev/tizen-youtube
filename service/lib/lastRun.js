'use strict';

const postmortem = require('./postmortem.js');

const ENDING = /^\S+ {2}((?:uncaught|exit|unhandled rejection|route): .*)$/;
const MOST = 5;

const endings = () => {
    const lines = postmortem.read().split('\n');
    const started = lines.map((line) => / {2}started: /.test(line)).lastIndexOf(true);

    return lines.slice(started + 1)
        .map((line) => ENDING.exec(line))
        .filter(Boolean)
        .map((match) => match[1])
        .slice(-MOST);
};

// Before this run notes anything.
const recall = () => endings().forEach((text) => postmortem.remember('previous', text));

module.exports = { recall };
