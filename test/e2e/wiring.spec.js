// That every feature is registered, reached, and survived contact with a real page.

import { test, expect, APP } from './tube.js';

// What register.js says when a feature does not start, and when one registers too late to run.
const BROKEN = /\[.+\] did not start:|\[register\] .+ arrived after boot/;

const EVERYTHING_ON = {
    startupPage: 'FEsubscriptions',
    scrollSpeed: '2',
    enableRapidPress: true,
    enableSmoothNavigation: true,
    enableAdBlock: true,
    enableSponsorBlock: true,
    enableSponsorBlockToasts: true,
    enableDeArrow: true,
    enableDeArrowThumbnails: true,
    enableShorts: true,
    enableHqThumbnails: true,
    enableHideWatchedVideos: true,
    hideWatchedVideosPages: ['home'],
    hideWatchedVideosThreshold: 50,
    enableHideEndScreenCards: true,
    hideShoppingAction: true,
    enablePaidPromotionOverlay: false,
    enableUpNextCard: false,
    enableYouThereRenderer: false,
    enableSigninReminder: true,
    enableShowUserLanguage: true,
    enableShowOtherLanguages: true,
    rememberPlaybackSpeed: true,
    videoPreferredCodec: 'vp9',
    preferredVideoQuality: '1080p',
    speedSettingsIncrement: 0.5,
    enableWhoIsWatchingMenu: true,
    permanentlyEnableWhoIsWatchingMenu: true,
    enableWhosWatchingMenuOnAppExit: true,
    enablePreviousNextButtons: true,
    enableMPButton: true,
    enableSuperThanksButton: true,
    enableAIAskButton: true,
    disabledSidebarContents: ['GAMING']
};

const watchConsole = (page) => {
    const said = [];
    page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') said.push(message.text());
    });
    return said;
};

test('no feature failed to start, on the settings it ships with', async ({ page, open }) => {
    const said = watchConsole(page);
    await open({});

    const broken = said.filter((line) => BROKEN.test(line));
    expect(broken, `a feature did not start: ${broken.join(' | ')}`).toEqual([]);
});

test('nor with every feature switched on', async ({ page, open }) => {
    const said = watchConsole(page);
    await open(EVERYTHING_ON);

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
