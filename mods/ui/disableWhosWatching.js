import { configChangeEmitter, configRead } from '../config.js';

const RECURRING_ACTIONS = 'yt.leanback.default::recurring_actions';

const WAIT_WINDOW = 15000;
const WAIT_INTERVAL = 250;

const PROMPTS = [
    'startup-screen-account-selector-with-guest',
    'whos_watching_fullscreen_zero_accounts',
    'startup-screen-signed-out-welcome-back'
];

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
        date.setDate(date.getDate() + 7);
        setActions();
    } else {
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

if (!disableWhosWatching(configRead('enableWhoIsWatchingMenu'))) {
    const until = Date.now() + WAIT_WINDOW;
    const waiting = setInterval(() => {
        if (disableWhosWatching(configRead('enableWhoIsWatchingMenu')) || Date.now() > until) {
            clearInterval(waiting);
        }
    }, WAIT_INTERVAL);
}
