'use strict';

// What happened, in one place, so a fault can be read rather than reproduced.
//
// A television has no console and no debugger. Everything worth knowing about a playback —
// what the page decided, what was fetched, where a stream was sent, why one was given up on
// — is written here from both sides and read back over the diagnostics bridge.
//
// Development only: nothing calls into this unless the bridge is open.

// Enough to cover a whole playback and its startup, small enough to leave alone.
const KEEP = 400;

const lines = [];
const started = Date.now();

/** One line. `from` is `page` or `service`, `topic` groups them for reading. */
function note(from, topic, text) {
    lines.push({ at: Date.now(), from, topic, text: String(text) });
    if (lines.length > KEEP) lines.shift();
}

/** From the service's own side. */
const service = (topic, text) => note('service', topic, text);

/** From the page, already timestamped there; kept in the order it says. */
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

/** As text, oldest first, seconds since the service started. */
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

module.exports = { KEEP, clear, fromPage, note, read, service };
