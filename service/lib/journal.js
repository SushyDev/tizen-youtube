'use strict';

const KEEP = 400;
const STARTED = Date.now();

const state = { listening: false, lines: [] };

const open = (yes) => {
    state.listening = !!yes;
    if (!yes) state.lines = [];
};

const wanted = () => state.listening;

const note = (from, topic, text) => {
    if (!state.listening) return;

    const line = { at: Date.now(), from, topic: String(topic), text: String(text) };
    state.lines = state.lines.concat([line]).slice(-KEEP);
};

const service = (topic, text) => note('service', topic, text);

const fromPage = (entries) => {
    if (!state.listening || !entries || !entries.length) return;

    state.lines = state.lines.concat(entries.map((entry) => ({
        at: Number(entry && entry.at) || Date.now(),
        from: 'page',
        topic: String((entry && entry.topic) || '?'),
        text: String((entry && entry.text) || '')
    }))).sort((a, b) => a.at - b.at).slice(-KEEP);
};

const read = (count) => (count > 0 ? state.lines.slice(-count) : state.lines)
    .map((line) => {
        const at = ((line.at - STARTED) / 1000).toFixed(1).padStart(7);
        return `${at}s ${line.from.padEnd(7)} ${line.topic.padEnd(9)} ${line.text}`;
    })
    .join('\n');

const clear = () => { state.lines = []; };

module.exports = { clear, fromPage, open, read, service, wanted };
