// That every feature is registered, reached, and survived contact with a real page.
//
// This is the thing only a browser can check. The unit suites import a mod and call it, so they
// pass just as happily on one nobody registered in mods/index.js, and on one whose start() throws
// — the phase runner catches that so a single feature cannot take the rest down, which means a
// dead feature looks exactly like a working one. It cost two build-and-install rounds to find that
// startPage.js was throwing on a History API the container does not have.

import { test, expect, APP } from './tube.js';

// What register.js says when a feature does not start, and when one registers too late to run.
const BROKEN = /\[.+\] did not start:|\[register\] .+ arrived after boot/;

const watchConsole = (page) => {
    const said = [];
    page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') said.push(message.text());
    });
    return said;
};

test('no feature failed to start', async ({ page, open }) => {
    const said = watchConsole(page);
    await open({});

    const broken = said.filter((line) => BROKEN.test(line));
    expect(broken, `a feature did not start: ${broken.join(' | ')}`).toEqual([]);
});

// Everything YouTube itself does happens under a nonce policy that refuses an unnonced script, so
// this is also the check that the injection is still quoting the right nonce.
test('the bundle ran rather than being refused by the policy', async ({ page, open }) => {
    const said = watchConsole(page);
    await open({});

    const refused = said.filter((line) => /Content Security Policy|Refused to (load|execute)/i.test(line));
    expect(refused, `the page refused our script: ${refused.join(' | ')}`).toEqual([]);
});

test('a watch page draws its player with the player mods in the path', async ({ page, open }) => {
    const { failures } = await open({}, '/tv#/watch?v=LXb3EKWsInQ');

    await expect(page.locator(APP).first()).toBeAttached();
    await expect(page.locator('ytlr-player, ytlr-watch').first()).toBeAttached({ timeout: 45000 });

    expect(failures, `the watch page threw: ${failures.join(' | ')}`).toEqual([]);
});
