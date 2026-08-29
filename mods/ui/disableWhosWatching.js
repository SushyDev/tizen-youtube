import { configChangeEmitter, configRead } from '../config.js';

// Where YouTube records when each of its startup prompts last fired. Pushing a
// `lastFired` into the future is how a prompt is suppressed, and pulling it back is how
// one is asked for.
const RECURRING_ACTIONS = 'yt.leanback.default::recurring_actions';

// The store does not exist on a first launch: this script runs before the page has
// written anything, and the page writes it a moment later. Reading it blind threw a
// SyntaxError out of module evaluation — which took the rest of core.js with it,
// `interceptJson()` included, so a first launch ran with no modification at all. The
// unsuppressed "You're signed out" prompt was the visible half of that.
const WAIT_WINDOW = 15000;
const WAIT_INTERVAL = 250;

// The three prompts, and whether each one is a prompt this store happens to carry: a
// signed-out set has never fired most of them, so most of the entries are simply absent.
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
            if (actions[prompt]) actions[prompt].lastFired = date.getTime();
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

// On a first launch the store lands a moment after this runs, so the setting is applied
// the moment there is something to apply it to. That is not a full substitute for
// running first: the page has its own copy in memory by then and writes it back over
// ours within the second, so the very first launch of a fresh install can still see the
// prompt. Every launch after it reads the store at document-start and takes this path
// once, synchronously, before the page has loaded anything.
if (!disableWhosWatching(configRead('enableWhoIsWatchingMenu'))) {
    const until = Date.now() + WAIT_WINDOW;
    const waiting = setInterval(() => {
        if (disableWhosWatching(configRead('enableWhoIsWatchingMenu')) || Date.now() > until) {
            clearInterval(waiting);
        }
    }, WAIT_INTERVAL);
}
