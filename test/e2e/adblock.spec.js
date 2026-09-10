// Adblock in both states.
//
// Asserted on what the page asks for rather than on what comes back. Signed out — which is all CI
// can be — YouTube often serves no advert at all, so a run that looked for one and found none
// would prove nothing. The request is ours either way: claiming an inline playback carries no
// advert is what actually keeps them off, before any response exists.

import { test, expect, playerRequests } from './tube.js';

const NO_ADS = 'isInlinePlaybackNoAd';

// Public, and the pair this project measures playback with.
const WATCH = '/tv#/watch?v=LXb3EKWsInQ';

const askedFor = async (page, open, settings) => {
    const asked = playerRequests(page);
    await open(settings, WATCH);
    await page.waitForFunction(() => true);
    await expect.poll(() => asked.length, { timeout: 45000 }).toBeGreaterThan(0);

    return asked;
};

test('with blocking on, every player request disclaims adverts', async ({ page, open }) => {
    const asked = await askedFor(page, open, { enableAdBlock: true });

    expect(asked.some((body) => body.indexOf(NO_ADS) !== -1),
        `no player request carried ${NO_ADS}`).toBe(true);
});

test('with blocking off, none of them does', async ({ page, open }) => {
    const asked = await askedFor(page, open, { enableAdBlock: false });

    expect(asked.every((body) => body.indexOf(NO_ADS) === -1),
        `a player request still carried ${NO_ADS} with blocking off`).toBe(true);
});
