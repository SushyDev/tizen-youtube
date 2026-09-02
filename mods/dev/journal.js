import { configRead } from '../config.js';

// The page's half of the journal. What the player decided and what was done about it, sent
// to the service so both halves of a playback can be read on one timeline.
//
// Development only, and cheap when off: `note` returns immediately, so a call site can say
// what happened without weighing anything up first.

// Batched rather than sent per line: a startup writes a few dozen, and a request each would
// be work competing with the decode they are describing.
const FLUSH_EVERY = 1000;
const MOST_HELD = 200;

const held = [];
let flushing = null;

const wanted = () => {
    try {
        return typeof window !== 'undefined' && configRead('enableDevBridge');
    } catch (e) {
        return false;
    }
};

function flush() {
    if (!held.length) return;

    const lines = held.splice(0, held.length);

    fetch(`${window.location.origin}/__tube/dev/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines })
    }).catch(() => { /* nothing is listening; the lines are gone and that is fine */ });
}

/** Records one line. `topic` groups them: `player`, `stream`, `choice`, `element`. */
export function note(topic, text) {
    if (!wanted()) return;

    held.push({ at: Date.now(), topic, text: String(text) });
    if (held.length > MOST_HELD) held.shift();

    if (!flushing) flushing = setInterval(flush, FLUSH_EVERY);
}
