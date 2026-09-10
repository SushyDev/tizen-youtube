// The feed dressers that had no test of their own.
//
// Each is a visitor over a response, so each is exercised through JSON.parse rather than by
// calling it: registration, the walk that reaches it, and the setting it answers to are all part
// of what can be wrong, and only the whole path covers them.
//
// Every one is checked in both states. A setting that reads the config but ignores it looks
// exactly like a setting that works, until someone turns it off.

import assert from 'assert';

global.window = { localStorage: { 'tube.settings': '{}' }, addEventListener: () => undefined };
global.window.JSON = JSON;
global.location = { hash: '#/' };
global.fetch = () => new Promise(() => { });

const { configRead, configWrite } = await import('../framework/config.js');
const { interceptJson } = await import('../framework/json.js');
await import('../mods/feed/index.js');

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

// A browse surface, which is the shape the walk descends to reach a tile.
const surface = (items) => ({
    contents: {
        tvBrowseRenderer: {
            content: {
                tvSurfaceContentRenderer: {
                    content: {
                        sectionListRenderer: {
                            contents: [{
                                shelfRenderer: { content: { horizontalListRenderer: { items } } }
                            }]
                        }
                    }
                }
            }
        }
    }
});

const tilesOf = (out) => out.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer
    .content.sectionListRenderer.contents[0].shelfRenderer.content.horizontalListRenderer.items;

const video = (videoId, extra) => ({
    tileRenderer: Object.assign({
        style: 'TILE_STYLE_YTLR_DEFAULT',
        contentId: videoId,
        onSelectCommand: { watchEndpoint: { videoId } },
        header: {
            tileHeaderRenderer: {
                thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }] }
            }
        }
    }, extra || {})
});

const watched = (videoId, percent) => {
    const tile = video(videoId);
    tile.tileRenderer.header.tileHeaderRenderer.thumbnailOverlays = [
        { thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: percent } }
    ];
    return tile;
};

// -- shorts --------------------------------------------------------------------------------

const SHORT = { tileRenderer: { tvhtml5ShelfRendererType: 'TVHTML5_TILE_RENDERER_TYPE_SHORTS' } };

check('shorts are dropped from a row that mixes them with ordinary videos', () => {
    withConfig({ enableShorts: false }, () => {
        const out = through(surface([video('a'), SHORT, video('b')]));
        assert.deepStrictEqual(tilesOf(out).map((t) => t.tileRenderer.contentId), ['a', 'b']);
    });
});

check('and kept when the setting is on', () => {
    withConfig({ enableShorts: true }, () => {
        assert.strictEqual(tilesOf(through(surface([video('a'), SHORT]))).length, 2);
    });
});

// -- watched videos ------------------------------------------------------------------------

check('a video watched past the threshold is dropped on a chosen page', () => {
    withConfig({
        enableHideWatchedVideos: true, hideWatchedVideosThreshold: 80, hideWatchedVideosPages: ['home']
    }, () => {
        const out = through(surface([watched('seen', 95), watched('part', 20), video('fresh')]));
        assert.deepStrictEqual(tilesOf(out).map((t) => t.tileRenderer.contentId), ['part', 'fresh']);
    });
});

check('and kept on a page that was not chosen', () => {
    withConfig({
        enableHideWatchedVideos: true, hideWatchedVideosThreshold: 80, hideWatchedVideosPages: ['search']
    }, () => {
        assert.strictEqual(tilesOf(through(surface([watched('seen', 95)]))).length, 1);
    });
});

check('and kept with the setting off', () => {
    withConfig({
        enableHideWatchedVideos: false, hideWatchedVideosPages: ['home']
    }, () => {
        assert.strictEqual(tilesOf(through(surface([watched('seen', 95)]))).length, 1);
    });
});

// -- thumbnails ----------------------------------------------------------------------------

const thumbnailOf = (out) => tilesOf(out)[0].tileRenderer.header.tileHeaderRenderer
    .thumbnail.thumbnails[0].url;

check('a thumbnail is asked for at the larger size', () => {
    withConfig({ enableHqThumbnails: true }, () => {
        assert.strictEqual(thumbnailOf(through(surface([video('abc')]))),
            'https://i.ytimg.com/vi/abc/sddefault.jpg');
    });
});

check('and left alone with the setting off', () => {
    withConfig({ enableHqThumbnails: false }, () => {
        assert.strictEqual(thumbnailOf(through(surface([video('abc')]))),
            'https://i.ytimg.com/vi/abc/hqdefault.jpg');
    });
});

// Someone else's host is not ours to rewrite: a substituted thumbnail would be replaced by a
// YouTube URL for the same video, which is the DeArrow picture silently undone.
check('a thumbnail from another host is left alone', () => {
    withConfig({ enableHqThumbnails: true }, () => {
        const tile = video('abc');
        tile.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails =
            [{ url: 'https://dearrow.ajay.app/thumbnail/abc' }];

        assert.strictEqual(thumbnailOf(through(surface([tile]))),
            'https://dearrow.ajay.app/thumbnail/abc');
    });
});

// -- the whole-response dressers -------------------------------------------------------------

check('end screen cards are dropped only when asked for', () => {
    withConfig({ enableHideEndScreenCards: true }, () =>
        assert.strictEqual(through({ endscreen: { x: 1 } }).endscreen, null));

    withConfig({ enableHideEndScreenCards: false }, () =>
        assert.deepStrictEqual(through({ endscreen: { x: 1 } }).endscreen, { x: 1 }));
});

check('the paid promotion badge is dropped only when asked for', () => {
    withConfig({ enablePaidPromotionOverlay: false }, () =>
        assert.strictEqual(through({ paidContentOverlay: { x: 1 } }).paidContentOverlay, null));

    withConfig({ enablePaidPromotionOverlay: true }, () =>
        assert.deepStrictEqual(through({ paidContentOverlay: { x: 1 } }).paidContentOverlay, { x: 1 }));
});

check('are you still watching is dropped from the messages, and nothing else is', () => {
    const messages = () => ({ messages: [{ youThereRenderer: {} }, { otherRenderer: {} }] });

    withConfig({ enableYouThereRenderer: false }, () =>
        assert.deepStrictEqual(through(messages()).messages, [{ otherRenderer: {} }]));

    withConfig({ enableYouThereRenderer: true }, () =>
        assert.strictEqual(through(messages()).messages.length, 2));
});

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
