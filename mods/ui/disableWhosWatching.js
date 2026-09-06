import { configChangeEmitter, configRead } from '../config.js';
import { waitFor } from '../utils/waitFor.js';

const RECURRING_ACTIONS = 'yt.leanback.default::recurring_actions';

const WAIT_WINDOW = 15000;
const WAIT_INTERVAL = 250;
const RECENT = 2 * 60 * 60 * 1000;
const KEEP_ALIVE = 60 * 1000;
const WEEK = 7;

const GUEST_PROMPT = 'startup-screen-account-selector-with-guest';

const PROMPTS = [
    GUEST_PROMPT,
    'whos_watching_fullscreen_zero_accounts',
    'startup-screen-signed-out-welcome-back'
];

const state = { keepAlive: null };

const readActions = () => {
    try {
        const parsed = JSON.parse(localStorage[RECURRING_ACTIONS]);
        return parsed && parsed.data && parsed.data.data ? parsed : null;
    } catch (error) {
        return null;
    }
};

function disableWhosWatching(enabled) {
    const stored = readActions();
    if (!stored) return false;

    const actions = stored.data.data;
    const permanent = configRead('permanentlyEnableWhoIsWatchingMenu');
    const date = new Date();

    const stampAll = () => {
        PROMPTS.forEach((prompt) => {
            if (!actions[prompt]) actions[prompt] = {};
            actions[prompt].lastFired = date.getTime();
        });

        localStorage[RECURRING_ACTIONS] = JSON.stringify(stored);
    };

    if (!enabled) {
        date.setDate(date.getDate() + WEEK);
        stampAll();
        return true;
    }

    const lastFired = (actions[GUEST_PROMPT] || {}).lastFired;
    const since = date.getTime() - lastFired;

    if (!permanent && since > 0 && since < RECENT) return true;

    stampAll();

    if (permanent) {
        date.setDate(date.getDate() - WEEK);
        stampAll();
        state.keepAlive = state.keepAlive || setInterval(stampAll, KEEP_ALIVE);
    } else if (state.keepAlive) {
        clearInterval(state.keepAlive);
        state.keepAlive = null;
    }

    return true;
}

configChangeEmitter.addEventListener('configChange', (event) => {
    if (event.detail.key === 'enableWhoIsWatchingMenu') disableWhosWatching(event.detail.value);
});

// localStorage may not carry the record yet when this module loads.
waitFor(
    () => disableWhosWatching(configRead('enableWhoIsWatchingMenu')),
    () => {},
    { every: WAIT_INTERVAL, forMs: WAIT_WINDOW }
);

// Only while the app is starting: a selector the viewer opened themselves is one they meant to
// open. The app acts on what it believes is focused rather than on what was clicked, so the
// container is focused first and the key goes to the document as well as to the tile.
const SELECTOR = 'ytlr-account-selector';
const ANSWER_WITHIN = 60000;

const answerSelector = () => {
    const selector = document.querySelector(SELECTOR);
    if (!selector) return false;

    const tile = selector.querySelector('ytlr-tile-renderer');
    if (!tile) return false;

    const target = (tile.closest && tile.closest('yt-focus-container')) || tile;

    try {
        target.focus();
    } catch (error) {
        // Not focusable on this build; the key events below still reach the app.
    }

    [document, target].forEach((node) => {
        ['keydown', 'keypress', 'keyup'].forEach((type) => {
            node.dispatchEvent(new KeyboardEvent(type, {
                bubbles: true, cancelable: true, composed: true,
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13
            }));
        });
    });

    return true;
};

// This runs before the page has a body, so the watch is armed on whichever exists first.
const watchForSelector = () => {
    const until = Date.now() + ANSWER_WITHIN;

    const watching = new MutationObserver(() => {
        if (Date.now() > until) return watching.disconnect();
        if (configRead('enableWhoIsWatchingMenu') || configRead('permanentlyEnableWhoIsWatchingMenu')) return undefined;
        if (answerSelector()) watching.disconnect();

        return undefined;
    });

    watching.observe(document.body || document.documentElement, { childList: true, subtree: true });
};

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    if (document.body) watchForSelector();
    else document.addEventListener('DOMContentLoaded', watchForSelector, { once: true });
}
