import { DEV_TOOLS, configRead } from '../../framework/index.js';
import { servedByService } from './devBridge.js';

const FLUSH_EVERY = 1000;
const MOST_HELD = 200;

const state = { held: [], flushing: null };

const wanted = () => {
    if (!DEV_TOOLS) return false;

    try {
        return typeof window !== 'undefined' && servedByService() && configRead('enableDevBridge');
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

    const lines = state.held;
    state.held = [];

    fetch(`${window.location.origin}/__tube/dev/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines })
    }).catch(() => { });
};

export function note(topic, text) {
    if (!wanted()) return;

    state.held = state.held.concat([{ at: Date.now(), topic, text: String(text) }]).slice(-MOST_HELD);

    if (!state.flushing) state.flushing = setInterval(flush, FLUSH_EVERY);
}
