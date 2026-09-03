import { configChangeEmitter, configRead } from '../config.js';

// Where YouTube records when each of its startup prompts last fired. Pushing a
// `lastFired` into the future is how a prompt is suppressed, and pulling it back is how
// one is asked for.
const RECURRING_ACTIONS = 'yt.leanback.default::recurring_actions';

// The store is absent on a first launch, and reading it blind threw out of module
// evaluation — taking the rest of core.js with it.
const WAIT_WINDOW = 15000;
const WAIT_INTERVAL = 250;

// A signed-out set has never fired most of these, so most entries are simply absent.
const PROMPTS = [
    'startup-screen-account-selector-with-guest',
    'whos_watching_fullscreen_zero_accounts',
    'startup-screen-signed-out-welcome-back'
];

/** The parsed store, or null while it is absent or unreadable. */
function readActions() {
    try {
        const parsed = JSON.parse(localStorage[RECURRING_ACTIONS]);
        return parsed && parsed.data && parsed.data.data ? parsed : null;
    } catch (error) {
        return null;
    }
}

configChangeEmitter.addEventListener('configChange', (event) => {
    const { key, value } = event.detail;
    if (key === 'enableWhoIsWatchingMenu') {
        disableWhosWatching(value);
    }
});

let interval;

/** False when the store is not there yet, which is the caller's cue to wait for it. */
function disableWhosWatching(value) {
    const LeanbackRecurringActions = readActions();
    if (!LeanbackRecurringActions) return false;

    const actions = LeanbackRecurringActions.data.data;
    const shouldPermanentlyEnable = configRead('permanentlyEnableWhoIsWatchingMenu');
    const date = new Date();

    function setActions() {
        PROMPTS.forEach((prompt) => {
            // A prompt that never fired has no entry to push, which is all of them on
            // a first launch.
            if (!actions[prompt]) actions[prompt] = {};
            actions[prompt].lastFired = date.getTime();
        });
        localStorage[RECURRING_ACTIONS] = JSON.stringify(LeanbackRecurringActions);
    }

    if (!value) {
        // 7 days is enough; this runs on every app launch.
        date.setDate(date.getDate() + 7);
        setActions();
    } else {
        // Do nothing if the last fired action is less than 2 hours ago.
        if (date.getTime() - actions['startup-screen-account-selector-with-guest']?.lastFired > 0 && date.getTime() - actions['startup-screen-account-selector-with-guest']?.lastFired < 2 * 60 * 60 * 1000
        && !shouldPermanentlyEnable) {
            return true;
        }
        setActions();
        if (shouldPermanentlyEnable) {
            date.setDate(date.getDate() - 7);
            setActions();
            interval = setInterval(setActions, 60 * 1000);
        } else if (interval) clearInterval(interval);
    }

    return true;
}

// On a first launch the store lands after this runs, so it is applied as soon as there
// is something to apply it to. The page still overwrites it within the second, so a
// fresh install can see the prompt once. Every later launch reads it at document-start
// once, synchronously, before the page has loaded anything.
if (!disableWhosWatching(configRead('enableWhoIsWatchingMenu'))) {
    const until = Date.now() + WAIT_WINDOW;
    const waiting = setInterval(() => {
        if (disableWhosWatching(configRead('enableWhoIsWatchingMenu')) || Date.now() > until) {
            clearInterval(waiting);
        }
    }, WAIT_INTERVAL);
}

// The carousel a signed-in set with several accounts is shown on startup.
//
// Pushing YouTube's own "last fired" record a week ahead suppresses the three prompts that
// record covers, and this is not one of them — it arrived on launch after launch with the
// setting off. It is not a command either: nothing reaches `resolveCommand` for it, so
// there is nothing to intercept. What there is, is a screen with the accounts on it, the
// first of them the one already signed in.
//
// Choosing that one changes nothing about who is watching. It only gets the screen out of
// the way of an app that was told not to ask.
const SELECTOR = 'ytlr-account-selector';

// The tile is inside a focus container, and the app acts on what it believes is focused
// rather than on what was clicked — so the container is focused first and the key is sent
// to the document as well as to the tile. Everything else was tried and dismissed it only
// sometimes.
function answerSelector() {
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
}

// Only while the app is starting. An account selector the viewer opened themselves, from
// the sidebar, is one they meant to open.
const ANSWER_WITHIN = 60000;

// This runs before the page has a body, so the watch is armed on whichever of the two
// exists first — the body, or the document while it is still being built.
function watchForSelector() {
    const until = Date.now() + ANSWER_WITHIN;

    const watching = new MutationObserver(() => {
        if (Date.now() > until) return watching.disconnect();
        if (configRead('enableWhoIsWatchingMenu') || configRead('permanentlyEnableWhoIsWatchingMenu')) return;
        if (answerSelector()) watching.disconnect();
    });

    watching.observe(document.body || document.documentElement, { childList: true, subtree: true });
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    if (document.body) watchForSelector();
    else document.addEventListener('DOMContentLoaded', watchForSelector, { once: true });
}
