'use strict';

// Development only, and it costs nothing when nobody is reading: until the bridge opens
// every line is dropped where it is written, so a release does no work for these.

const KEEP = 400;

const lines = [];
const started = Date.now();

let listening = false;

const open = (yes) => { listening = !!yes; if (!yes) lines.length = 0; };

const wanted = () => listening;

function note(from, topic, text) {
    if (!listening) return;

    lines.push({ at: Date.now(), from, topic, text: String(text) });
    if (lines.length > KEEP) lines.shift();
}

const service = (topic, text) => note('service', topic, text);

function fromPage(entries) {
    (entries || []).forEach((entry) => {
        lines.push({
            at: Number(entry.at) || Date.now(),
            from: 'page',
            topic: String(entry.topic || '?'),
            text: String(entry.text || '')
        });
    });

    lines.sort((a, b) => a.at - b.at);
    while (lines.length > KEEP) lines.shift();
}

function read(count) {
    const wanted = count > 0 ? lines.slice(-count) : lines;

    return wanted.map((line) => {
        const at = ((line.at - started) / 1000).toFixed(1).padStart(7);
        return `${at}s ${line.from === 'page' ? 'page   ' : 'service'} ${line.topic.padEnd(9)} ${line.text}`;
    }).join('\n');
}

function clear() {
    lines.length = 0;
}

module.exports = { clear, fromPage, note, open, read, service, wanted };
