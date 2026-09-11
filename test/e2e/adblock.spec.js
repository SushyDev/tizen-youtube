// Asserts on the player request, because signed-out CI is often served no advert to look for.

import { test, expect, playerRequests } from './tube.js';

const NO_ADS = 'isInlinePlaybackNoAd';

const WATCH = '/tv#/watch?v=LXb3EKWsInQ';

const askedFor = async (page, open, settings) => {
    const asked = playerRequests(page);
    await open(settings, WATCH);
    await expect.poll(() => asked.length, { timeout: 45000 }).toBeGreaterThan(0);

    return asked;
};

test('with blocking on, a player request disclaims adverts', async ({ page, open }) => {
    const asked = await askedFor(page, open, { enableAdBlock: true });

    expect(asked.some((body) => body.indexOf(NO_ADS) !== -1),
        `no player request carried ${NO_ADS}`).toBe(true);
});

test('with blocking off, none of them does', async ({ page, open }) => {
    const asked = await askedFor(page, open, { enableAdBlock: false });

    expect(asked.every((body) => body.indexOf(NO_ADS) === -1),
        `a player request still carried ${NO_ADS} with blocking off`).toBe(true);
});
