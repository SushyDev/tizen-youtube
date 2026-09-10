import { test, expect, APP } from './tube.js';

test('the app boots with our bundle in it', async ({ page, open }) => {
    const { failures } = await open({});

    await expect(page.locator(APP).first()).toBeAttached();

    // Set by the proxy on every page it dresses, so its absence means the bundle never arrived.
    expect(await page.evaluate(() => window.__TUBE_NATIVE_PROXY_PATCHES__)).toBeDefined();

    expect(failures, `the page threw: ${failures.join(' | ')}`).toEqual([]);
});
