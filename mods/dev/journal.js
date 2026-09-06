import { configRead } from '../config.js';
import { DEV_TOOLS } from './tools.js';

const FLUSH_EVERY = 1000;
const MOST_HELD = 200;

const state = { held: [], flushing: null };

const wanted = () => {
    if (!DEV_TOOLS) return false;

    try {
        return typeof window !== 'undefined' && configRead('enableDevBridge');
    } catch (e) {
        return false;
    }
};

const flush = () => {
    if (!state.held.length) {
        clearInterval(state.flushing);
        state.flushing = null;
        return;
    }

    const lines = state.held.splice(0, state.held.length);

    fetch(`${window.location.origin}/__tube/dev/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines })
    }).catch(() => { });
};

export function note(topic, text) {
    if (!wanted()) return;

    state.held.push({ at: Date.now(), topic, text: String(text) });
    state.held.splice(0, Math.max(0, state.held.length - MOST_HELD));

    if (!state.flushing) state.flushing = setInterval(flush, FLUSH_EVERY);
}
