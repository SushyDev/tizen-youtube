import { configRead } from '../config.js';
import { DEV_TOOLS } from './tools.js';

const FLUSH_EVERY = 1000;
const MOST_HELD = 200;

const held = [];
let flushing = null;

const wanted = () => {
    if (!DEV_TOOLS) return false;

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
    }).catch(() => { });
}

export function note(topic, text) {
    if (!wanted()) return;

    held.push({ at: Date.now(), topic, text: String(text) });
    if (held.length > MOST_HELD) held.shift();

    if (!flushing) flushing = setInterval(flush, FLUSH_EVERY);
}
