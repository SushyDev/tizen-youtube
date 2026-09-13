'use strict';

// Lines a page sends for /__tube/log: the userscript's and the boot screen's.

const postmortem = require('./postmortem.js');

const PAGE = 'page';
const SCREEN = 'screen';
const LONGEST = 500;
const MOST_SAID = 30;
const REMEMBERED = 50;

const held = { recent: [] };

// A recent repeat is dropped, so a reload loop cannot flood the log.
const fromPage = (raw) => {
    const text = String(raw || '').slice(0, LONGEST);
    if (!text || held.recent.indexOf(text) !== -1) return;

    held.recent = held.recent.concat([text]).slice(-REMEMBERED);
    postmortem.note(PAGE, text);
};

const parsedLines = (raw) => {
    try {
        const lines = JSON.parse(String(raw));
        return Array.isArray(lines) ? lines : [];
    } catch (e) {
        postmortem.note(SCREEN, 'sent lines that did not parse');
        return [];
    }
};

// Sent as a JSON array; capped so a page cannot flood the log.
const fromScreen = (raw) => {
    if (!raw) return;

    parsedLines(raw).slice(0, MOST_SAID).forEach((line) => postmortem.note(SCREEN, String(line).slice(0, LONGEST)));
};

module.exports = { fromPage, fromScreen, PAGE, SCREEN };
