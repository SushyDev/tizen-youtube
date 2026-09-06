'use strict';

const KEEP = 400;
const STARTED = Date.now();

const state = { listening: false, lines: [] };

const trim = () => { while (state.lines.length > KEEP) state.lines.shift(); };

const open = (yes) => {
    state.listening = !!yes;
    if (!yes) state.lines.length = 0;
};

const wanted = () => state.listening;

const note = (from, topic, text) => {
    if (!state.listening) return;

    state.lines.push({ at: Date.now(), from, topic: String(topic), text: String(text) });
    trim();
};

const service = (topic, text) => note('service', topic, text);

const fromPage = (entries) => {
    if (!state.listening || !entries || !entries.length) return;

    entries.forEach((entry) => state.lines.push({
        at: Number(entry && entry.at) || Date.now(),
        from: 'page',
        topic: String((entry && entry.topic) || '?'),
        text: String((entry && entry.text) || '')
    }));

    state.lines.sort((a, b) => a.at - b.at);
    trim();
};

const read = (count) => (count > 0 ? state.lines.slice(-count) : state.lines)
    .map((line) => {
        const at = ((line.at - STARTED) / 1000).toFixed(1).padStart(7);
        return `${at}s ${line.from.padEnd(7)} ${line.topic.padEnd(9)} ${line.text}`;
    })
    .join('\n');

const clear = () => { state.lines.length = 0; };

module.exports = { clear, fromPage, note, open, read, service, wanted };
