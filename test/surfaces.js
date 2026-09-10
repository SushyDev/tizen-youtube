// Every place YouTube keeps a feed, and proof that the walk reaches all of them.
//
// This suite exists because of a bug that could only ever be a missing entry point: pressing
// Refresh at the foot of the home page brought back adverts and shorts, and nothing else did.
// Captured on the set, that response is 401KB with twenty-four tiles, one advert slot and one
// shorts shelf, and it arrives under `continuationContents.tvSurfaceContentContinuation` — a name
// surfaces.js did not know. Nine descents were listed there and the tenth was the one being used.
//
// A surface that is not walked is not a visible error. It is the feed simply going out undressed,
// which is why each of them is named here rather than trusted.

import assert from 'assert';

global.window = { localStorage: { 'tube.settings': '{}' }, addEventListener: () => undefined };
global.window.JSON = JSON;
global.location = { hash: '#/' };
global.fetch = () => new Promise(() => { });

const { configRead, configWrite } = await import('../framework/config.js');
const { interceptJson } = await import('../framework/json.js');
await import('../mods/feed/index.js');

// Not a feed mod, but it registers against the same walk — which is the point of the last two
// checks below.
await import('../mods/queue/shelf.js');

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

const BLOCKING = { enableAdBlock: true, enableShorts: false, enableSigninReminder: false };

const withConfig = (settings, run) => {
    const before = Object.keys(settings).map((key) => [key, configRead(key)]);
    Object.keys(settings).forEach((key) => configWrite(key, settings[key]));
    try {
        return run();
    } finally {
        before.forEach((entry) => configWrite(entry[0], entry[1]));
    }
};

const SHORTS_SHELF = 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS';

const tile = (id) => ({
    tileRenderer: { contentId: id, style: 'TILE_STYLE_YTLR_DEFAULT', onSelectCommand: {} }
});

const shortsTile = (id) => ({
    tileRenderer: {
        contentId: id,
        style: 'TILE_STYLE_YTLR_DEFAULT',
        tvhtml5ShelfRendererType: 'TVHTML5_TILE_RENDERER_TYPE_SHORTS',
        onSelectCommand: {}
    }
});

const shelf = (items, type) => ({
    shelfRenderer: Object.assign(
        { content: { horizontalListRenderer: { items } } },
        type ? { tvhtml5ShelfRendererType: type } : {}
    )
});

// One advert row, one shorts row, one ordinary row carrying a shorts tile and an advert slot.
const sections = () => ([
    { adSlotRenderer: {} },
    shelf([tile('a')], SHORTS_SHELF),
    shelf([tile('b'), shortsTile('s'), { adSlotRenderer: {} }])
]);

const tiles = () => ([tile('b'), shortsTile('s'), { adSlotRenderer: {} }]);

// What a walked section list looks like: the advert row and the shorts row gone, and the ordinary
// row left holding only its ordinary tile.
const walkedSections = (list, where) => {
    assert.strictEqual(list.length, 1, `${where}: expected one row, got ${list.length}`);
    const items = list[0].shelfRenderer.content.horizontalListRenderer.items;
    assert.deepStrictEqual(items.map((i) => i.tileRenderer && i.tileRenderer.contentId), ['b'],
        `${where}: the tiles inside the row were not walked`);
};

const walkedTiles = (list, where) => {
    assert.deepStrictEqual(list.map((i) => i.tileRenderer && i.tileRenderer.contentId), ['b'],
        `${where}: the tile list was not walked`);
};

const through = (response) => JSON.parse(JSON.stringify(response));

const surface = (content) => ({
    contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content } } } }
});

check('the home feed', () => {
    withConfig(BLOCKING, () => {
        const out = through(surface({ sectionListRenderer: { contents: sections() } }));
        walkedSections(out.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer
            .content.sectionListRenderer.contents, 'browse sections');
    });
});

check('a grid on the browse surface', () => {
    withConfig(BLOCKING, () => {
        const out = through(surface({ gridRenderer: { items: tiles() } }));
        walkedTiles(out.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer
            .content.gridRenderer.items, 'browse grid');
    });
});

check('a bare section list', () => {
    withConfig(BLOCKING, () => {
        const out = through({ contents: { sectionListRenderer: { contents: sections() } } });
        walkedSections(out.contents.sectionListRenderer.contents, 'bare sections');
    });
});

check('a section list continuation', () => {
    withConfig(BLOCKING, () => {
        const out = through({ continuationContents: { sectionListContinuation: { contents: sections() } } });
        walkedSections(out.continuationContents.sectionListContinuation.contents, 'section continuation');
    });
});

// This surface used to be the uneven one — shorts.js named three of the four, so scrolling right
// along a mixed row let the shorts through while the advert beside them went. Reproduced on the
// set, then evened up.
check('a horizontal continuation', () => {
    withConfig(BLOCKING, () => {
        const out = through({ continuationContents: { horizontalListContinuation: { items: tiles() } } });
        walkedTiles(out.continuationContents.horizontalListContinuation.items, 'horizontal continuation');
    });
});

check('a grid continuation', () => {
    withConfig(BLOCKING, () => {
        const out = through({ continuationContents: { gridContinuation: { items: tiles() } } });
        walkedTiles(out.continuationContents.gridContinuation.items, 'grid continuation');
    });
});

// The one that was missing. The shape is what the set actually sent.
check('the home page after pressing Refresh', () => {
    withConfig(BLOCKING, () => {
        const out = through({
            continuationContents: {
                tvSurfaceContentContinuation: {
                    content: { sectionListRenderer: { contents: sections() } },
                    targetId: 'browse-feedFEwhat_to_watch'
                }
            }
        });
        walkedSections(out.continuationContents.tvSurfaceContentContinuation
            .content.sectionListRenderer.contents, 'refresh');
    });
});

check('a grid arriving the same way', () => {
    withConfig(BLOCKING, () => {
        const out = through({
            continuationContents: { tvSurfaceContentContinuation: { content: { gridRenderer: { items: tiles() } } } }
        });
        walkedTiles(out.continuationContents.tvSurfaceContentContinuation.content.gridRenderer.items, 'refresh grid');
    });
});

check('every channel tab on the subscriptions page', () => {
    withConfig(BLOCKING, () => {
        const out = through({
            contents: {
                tvBrowseRenderer: {
                    content: {
                        tvSecondaryNavRenderer: {
                            sections: [{
                                tvSecondaryNavSectionRenderer: {
                                    tabs: [
                                        { tabRenderer: { content: { tvSurfaceContentRenderer: { content: { sectionListRenderer: { contents: sections() } } } } } },
                                        { tabRenderer: { title: 'A-Z' } }
                                    ]
                                }
                            }]
                        }
                    }
                }
            }
        });

        const tabs = out.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer
            .sections[0].tvSecondaryNavSectionRenderer.tabs;
        walkedSections(tabs[0].tabRenderer.content.tvSurfaceContentRenderer
            .content.sectionListRenderer.contents, 'subscription tab');
        assert.ok(tabs[1].tabRenderer, 'the A-Z divider, which carries no content, was disturbed');
    });
});

check('the suggestions beside a video', () => {
    withConfig(BLOCKING, () => {
        const out = through({
            contents: { singleColumnWatchNextResults: { pivot: { sectionListRenderer: { contents: sections() } } } }
        });
        walkedSections(out.contents.singleColumnWatchNextResults.pivot
            .sectionListRenderer.contents, 'watch-next pivot');
    });
});

// Search results, read off the set: a 1487KB response with 122 lockupViewModel and zero
// tileRenderer. The walk reached every one of those items already — descent #3, the plain section
// list — and every visitor declined them, because they are a renderer family none of them knew.
// Eight shorts on screen, all of them LOCKUP_CONTENT_TYPE_SHORT.
const lockup = (id, type) => ({
    lockupViewModel: {
        contentId: id,
        contentType: type || 'LOCKUP_CONTENT_TYPE_VIDEO',
        metadata: { lockupMetadataViewModel: { title: { content: id } } }
    }
});

const searchResults = (items) => ({
    estimatedResults: '1000',
    contents: { sectionListRenderer: { contents: [
        { shelfRenderer: { content: { horizontalListRenderer: { items } } } }
    ] } }
});

const resultsIn = (out) => out.contents.sectionListRenderer.contents[0]
    .shelfRenderer.content.horizontalListRenderer.items
    .map((i) => i.lockupViewModel && i.lockupViewModel.contentId);

check('shorts in search results are dropped like shorts anywhere else', () => {
    withConfig(BLOCKING, () => {
        const out = through(searchResults([
            lockup('video'), lockup('short-a', 'LOCKUP_CONTENT_TYPE_SHORT'),
            lockup('short-b', 'LOCKUP_CONTENT_TYPE_SHORT')
        ]));
        assert.deepStrictEqual(resultsIn(out), ['video']);
    });
});

check('and kept when shorts are wanted', () => {
    withConfig(Object.assign({}, BLOCKING, { enableShorts: true }), () => {
        const out = through(searchResults([
            lockup('video'), lockup('short-a', 'LOCKUP_CONTENT_TYPE_SHORT')
        ]));
        assert.deepStrictEqual(resultsIn(out), ['video', 'short-a']);
    });
});

check('an ordinary lockup is never mistaken for a short', () => {
    withConfig(BLOCKING, () => {
        const out = through(searchResults([lockup('a'), lockup('b'), lockup('c')]));
        assert.deepStrictEqual(resultsIn(out), ['a', 'b', 'c']);
    });
});

check('a response carrying none of them is untouched', () => {
    withConfig(BLOCKING, () => {
        assert.deepStrictEqual(through({ contents: { somethingElse: 1 } }), { contents: { somethingElse: 1 } });
    });
});

// The queue adds a row rather than changing one, which used to mean naming the pivot's path by
// hand — the same mistake in a different file. onSurface is how a mod does that now.
check('a mod can add a row to a surface without knowing where it lives', () => {
    global.window.queuedVideos = { videos: [tile('q')], lastVideoId: 'q' };

    withConfig(BLOCKING, () => {
        const out = through({
            contents: { singleColumnWatchNextResults: { pivot: { sectionListRenderer: { contents: sections() } } } }
        });

        const rows = out.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents;
        assert.strictEqual(rows.length, 2, 'the queue shelf was not added');
        assert.strictEqual(rows[0].shelfRenderer.shelfHeaderRenderer.title.simpleText, 'Queued Videos');
    });

    global.window.queuedVideos = null;
});

check('and adds nothing when there is nothing queued', () => {
    global.window.queuedVideos = { videos: [], lastVideoId: null };

    withConfig(BLOCKING, () => {
        const out = through({
            contents: { singleColumnWatchNextResults: { pivot: { sectionListRenderer: { contents: sections() } } } }
        });
        assert.strictEqual(out.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.length, 1);
    });

    global.window.queuedVideos = null;
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
