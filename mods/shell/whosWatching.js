import { configChangeEmitter, configRead, waitFor } from '../../framework/index.js';

const RECURRING_ACTIONS = 'yt.leanback.default::recurring_actions';

const WAIT_WINDOW = 15000;
const WAIT_INTERVAL = 250;
const RECENT = 2 * 60 * 60 * 1000;
const KEEP_ALIVE = 60 * 1000;
const WEEK = 7 * 24 * 60 * 60 * 1000;

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

const stampAll = (at) => {
    const stored = readActions();
    if (!stored) return;

    const actions = PROMPTS.reduce((all, prompt) => Object.assign({}, all, {
        [prompt]: Object.assign({}, all[prompt], { lastFired: at })
    }), stored.data.data);

    localStorage[RECURRING_ACTIONS] = JSON.stringify(
        Object.assign({}, stored, { data: Object.assign({}, stored.data, { data: actions }) })
    );
};

const applyWhosWatching = (enabled) => {
    const stored = readActions();
    if (!stored) return false;

    const actions = stored.data.data;
    const permanent = configRead('permanentlyEnableWhoIsWatchingMenu');
    const now = Date.now();

    if (!enabled || !permanent) {
        clearInterval(state.keepAlive);
        state.keepAlive = null;
    }

    if (!enabled) {
        stampAll(now + WEEK);
        return true;
    }

    const lastFired = (actions[GUEST_PROMPT] || {}).lastFired;
    const since = now - lastFired;

    if (!permanent && since > 0 && since < RECENT) return true;

    stampAll(permanent ? now - WEEK : now);

    if (permanent) state.keepAlive = state.keepAlive || setInterval(() => stampAll(now - WEEK), KEEP_ALIVE);

    return true;
};

configChangeEmitter.addEventListener('configChange', (event) => {
    if (['enableWhoIsWatchingMenu', 'permanentlyEnableWhoIsWatchingMenu'].includes(event.detail.key)) {
        applyWhosWatching(configRead('enableWhoIsWatchingMenu'));
    }
});

// localStorage may not carry the record yet when this module loads.
waitFor(
    readActions,
    () => applyWhosWatching(configRead('enableWhoIsWatchingMenu')),
    { everyMs: WAIT_INTERVAL, forMs: WAIT_WINDOW }
);

const ACCOUNT_SELECTOR = 'ytlr-account-selector';
const TILE = 'ytlr-tile-renderer';
const FOCUS_CONTAINER = 'yt-focus-container';
const ANSWER_WITHIN = 60 * 1000;
const RETRY_AFTER = 1000;

const answerSelector = () => {
    const picker = document.querySelector(ACCOUNT_SELECTOR);
    if (!picker) return false;

    const tile = picker.querySelector(TILE);
    if (!tile) return false;

    const target = (tile.closest && tile.closest(FOCUS_CONTAINER)) || tile;

    // The app routes keys to what it believes is focused, not to the element they are dispatched on.
    try {
        target.focus();
    } catch (error) {
    }

    ['keydown', 'keypress', 'keyup'].forEach((type) => {
        target.dispatchEvent(new KeyboardEvent(type, {
            bubbles: true, cancelable: true, composed: true,
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13
        }));
    });

    return true;
};

const watchForSelector = () => {
    const held = { pressedAt: 0 };

    const watching = new MutationObserver(() => {
        if (configRead('enableWhoIsWatchingMenu')) return undefined;
        if (held.pressedAt && !document.querySelector(ACCOUNT_SELECTOR)) return stop();
        if (Date.now() - held.pressedAt < RETRY_AFTER) return undefined;
        if (answerSelector()) held.pressedAt = Date.now();

        return undefined;
    });

    const onViewerKey = (event) => {
        if (event.isTrusted) stop();
    };

    const stop = () => {
        watching.disconnect();
        window.removeEventListener('keydown', onViewerKey, true);
    };

    window.addEventListener('keydown', onViewerKey, true);
    watching.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(stop, ANSWER_WITHIN);
};

watchForSelector();
