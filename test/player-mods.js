// The player and shell dressers that had no test of their own.
//
// All three answer a setting, and all three are checked in both states: a dresser that reads the
// config and ignores it is indistinguishable from one that works until someone turns it off.

import assert from 'assert';

global.window = { localStorage: { 'tube.settings': '{}' }, addEventListener: () => undefined };
global.window.JSON = JSON;
global.location = { hash: '#/' };
global.fetch = () => new Promise(() => { });
global.document = { querySelector: () => null, addEventListener: () => undefined };

const { configRead, configWrite } = await import('../framework/config.js');
const { interceptJson } = await import('../framework/json.js');
await import('../mods/player/codecs.js');
await import('../mods/player/overlays.js');
await import('../mods/player/autoplay.js');
await import('../mods/shell/guide.js');

interceptJson();

const results = [];

const check = (name, run) => {
    try {
        run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 5).join('\n      ')}`);
    }
};

const withConfig = (settings, run) => {
    const before = Object.keys(settings).map((key) => [key, configRead(key)]);
    Object.keys(settings).forEach((key) => configWrite(key, settings[key]));
    try {
        return run();
    } finally {
        before.forEach((entry) => configWrite(entry[0], entry[1]));
    }
};

const through = (response) => JSON.parse(JSON.stringify(response));

// -- codecs --------------------------------------------------------------------------------

const streams = () => ({
    streamingData: {
        adaptiveFormats: [
            { mimeType: 'video/webm; codecs="vp9"' },
            { mimeType: 'video/mp4; codecs="avc1.4d401f"' },
            { mimeType: 'audio/mp4; codecs="mp4a.40.2"' }
        ]
    }
});

const codecsIn = (out) => out.streamingData.adaptiveFormats.map((f) => f.mimeType);

check('a chosen codec keeps its own video formats and every audio one', () => {
    withConfig({ videoPreferredCodec: 'vp9' }, () => {
        assert.deepStrictEqual(codecsIn(through(streams())),
            ['video/webm; codecs="vp9"', 'audio/mp4; codecs="mp4a.40.2"']);
    });
});

check('Any leaves every format alone', () => {
    withConfig({ videoPreferredCodec: 'any' }, () =>
        assert.strictEqual(codecsIn(through(streams())).length, 3));
});

// Filtering to a codec the video does not carry would leave no video at all, which is a black
// screen rather than a fallback.
check('a codec the video does not carry leaves every format alone', () => {
    withConfig({ videoPreferredCodec: 'av01' }, () =>
        assert.strictEqual(codecsIn(through(streams())).length, 3));
});

// -- player overlays -----------------------------------------------------------------------

const overlays = () => ({
    playerOverlays: {
        playerOverlayRenderer: {
            timelyActionRenderers: [
                { timelyActionRenderer: { type: 'TIMELY_ACTION_TYPE_SHOPPING' } },
                { timelyActionRenderer: { type: 'TIMELY_ACTION_TYPE_NFL_WATERMARK' } },
                { timelyActionRenderer: { type: 'TIMELY_ACTION_TYPE_UP_NEXT' } }
            ]
        }
    }
});

const typesIn = (out) => out.playerOverlays.playerOverlayRenderer.timelyActionRenderers
    .map((a) => a.timelyActionRenderer.type);

check('the shopping card goes when asked, and the watermark goes regardless', () => {
    withConfig({ hideShoppingAction: true, enableUpNextCard: true }, () =>
        assert.deepStrictEqual(typesIn(through(overlays())), ['TIMELY_ACTION_TYPE_UP_NEXT']));

    withConfig({ hideShoppingAction: false, enableUpNextCard: true }, () =>
        assert.deepStrictEqual(typesIn(through(overlays())),
            ['TIMELY_ACTION_TYPE_SHOPPING', 'TIMELY_ACTION_TYPE_UP_NEXT']));
});

// -- up next -------------------------------------------------------------------------------

check('turning the up next card off stops the next video as well', () => {
    const response = () => ({
        playerOverlays: {
            playerOverlayRenderer: {
                isAutoplayEnabled: true,
                timelyActionRenderers: [{ timelyActionRenderer: { type: 'TIMELY_ACTION_TYPE_UP_NEXT' } }]
            }
        },
        contents: { singleColumnWatchNextResults: { autoplay: { autoplay: { sets: [{ x: 1 }] } } } }
    });

    withConfig({ enableUpNextCard: false, hideShoppingAction: false }, () => {
        const out = through(response());
        assert.deepStrictEqual(out.playerOverlays.playerOverlayRenderer.timelyActionRenderers, []);
        assert.notStrictEqual(out.playerOverlays.playerOverlayRenderer.isAutoplayEnabled, true);
    });

    withConfig({ enableUpNextCard: true, hideShoppingAction: false }, () => {
        const out = through(response());
        assert.strictEqual(out.playerOverlays.playerOverlayRenderer.timelyActionRenderers.length, 1);
    });
});

// -- the guide -----------------------------------------------------------------------------

const guide = () => ({
    items: [{
        guideSectionRenderer: {
            items: [
                { guideEntryRenderer: { icon: { iconType: 'GAMING' } } },
                { guideEntryRenderer: { icon: { iconType: 'SUBSCRIPTIONS' } } },
                { guideEntryRenderer: {} }
            ]
        }
    }]
});

const iconsIn = (out) => out.items[0].guideSectionRenderer.items
    .map((entry) => entry.guideEntryRenderer.icon?.iconType || 'none');

check('a hidden sidebar section is dropped and the rest are kept', () => {
    withConfig({ disabledSidebarContents: ['GAMING'] }, () =>
        assert.deepStrictEqual(iconsIn(through(guide())), ['SUBSCRIPTIONS', 'none']));
});

check('hiding nothing leaves the guide as it came', () => {
    withConfig({ disabledSidebarContents: [] }, () =>
        assert.deepStrictEqual(iconsIn(through(guide())), ['GAMING', 'SUBSCRIPTIONS', 'none']));
});

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
