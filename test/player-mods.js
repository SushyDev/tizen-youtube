import assert from 'assert';
import { check, withConfig, through, finish } from './harness.js';

global.document = { querySelector: () => null, addEventListener: () => undefined };

const { interceptJson } = await import('../framework/json.js');
await import('../mods/player/codecs.js');
await import('../mods/player/overlays.js');
await import('../mods/player/autoplay.js');
await import('../mods/shell/guide.js');

interceptJson();

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

finish();
