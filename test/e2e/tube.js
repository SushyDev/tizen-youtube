// Opening the app with a given set of our settings, and the handful of questions every spec asks.

import { test as base, expect } from '@playwright/test';

const SETTINGS_KEY = 'tube.settings';

// The app itself, waited for attached rather than visible: it carries no box of its own, so
// visibility never resolves. Not a tile either — signed out, which is all CI can be, YouTube opens
// on its welcome screen rather than a feed.
const APP = 'ytlr-app';

const test = base.extend({
    // Settings are read from localStorage when our bundle is evaluated, so they have to be there
    // before the page has run anything at all.
    open: async ({ page }, use) => {
        const failures = [];
        page.on('pageerror', (error) => failures.push(String(error.message)));

        const open = async (settings, path) => {
            await page.addInitScript(([key, value]) => {
                window.localStorage.setItem(key, value);
            }, [SETTINGS_KEY, JSON.stringify(settings || {})]);

            await page.goto(path || '/tv', { waitUntil: 'commit' });
            await page.locator(APP).first().waitFor({ state: 'attached', timeout: 60000 });

            // kabuki's flag store arrives with /tv_config, after its own script, so a switch we
            // answer is not answerable the instant the app appears.
            await page.waitForFunction(() => !!(window.tectonicConfig || {}).featureSwitches,
                null, { timeout: 30000 });

            return { failures };
        };

        await use(open);
    }
});

// kabuki's own flag store, which is where a switch we answer has to end up to have meant anything.
const switchOf = (page, name) => page.evaluate(
    (which) => (window.tectonicConfig || {}).featureSwitches?.[which],
    name
);

// What the page asks for a video, which is where adblock does the part that actually works.
const playerRequests = (page) => {
    const asked = [];

    page.on('request', (request) => {
        if (request.url().indexOf('/youtubei/v1/player') === -1) return;
        asked.push(request.postData() || '');
    });

    return asked;
};

export { test, expect, switchOf, playerRequests, APP, SETTINGS_KEY };
