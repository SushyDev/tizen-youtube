// Diffs the registered feed visitors against the pre-rewrite helpers.

import assert from 'assert';

// Set before the graph loads: config.js reads window.localStorage at module scope. It catches a
// failure and falls back to defaults, but then configWrite has nowhere to persist and the
// scenarios below could not toggle anything.
global.window = { localStorage: { 'tube.settings': '{}' } };
global.location = { hash: '#/' };

const fetches = { calls: [] };
global.fetch = (url) => {
    fetches.calls.push(url);
    return new Promise(() => { });
};

const { configRead, configWrite } = await import('../framework/config.js');
const { MenuServiceItemRenderer, longPressData } = await import('../framework/ytUI.js');
const { SHELF, PIVOT, TILES, GRID, walkTiles, walkShelves } = await import('../framework/feed.js');

// Importing for its registrations, which is the whole point: the visitor table under test is the
// one the shipped code installs, not one written for the test.
await import('../mods/feed/adblock.js');

// -- the oracle: exactly what these were before ------------------------------------------------

function oracleDeArrowify(items) {
    items.filter((item) => item.adSlotRenderer)
        .forEach((advert) => items.splice(items.indexOf(advert), 1));

    items.forEach((item) => {
        if (!item.tileRenderer) return;
        if (configRead('enableDeArrow')) {
            const videoID = item.tileRenderer.contentId;
            fetch(`https://sponsor.ajay.app/api/branding?videoID=${videoID}`);
        }
    });
}

function oracleHqify(items) {
    items.forEach((item) => {
        if (!item.tileRenderer) return;
        if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') return;
        if (configRead('enableHqThumbnails')) {
            if (!item.tileRenderer.onSelectCommand?.watchEndpoint?.videoId) return;
            if (!item.tileRenderer.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.[0]?.url) return;
            const videoID = item.tileRenderer.onSelectCommand.watchEndpoint.videoId;
            const queryArgs = item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0].url.split('?')[1];
            item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [
                {
                    url: `https://i.ytimg.com/vi/${videoID}/sddefault.jpg${queryArgs ? `?${queryArgs}` : ''}`,
                    width: 640,
                    height: 480
                }
            ];
        }
    });
}

function oracleAddLongPress(items) {
    items.forEach((item) => {
        if (!item.tileRenderer) return;
        if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') return;
        if (item.tileRenderer.onLongPressCommand?.showMenuCommand?.menu?.menuRenderer?.items) {
            const copied = JSON.parse(JSON.stringify(item));
            item.tileRenderer.onLongPressCommand.showMenuCommand.menu.menuRenderer.items.push(MenuServiceItemRenderer('Add to Queue', {
                clickTrackingParams: null,
                playlistEditEndpoint: { customAction: { action: 'ADD_TO_QUEUE', parameters: copied } }
            }));
            return;
        }
        if (!item.tileRenderer?.metadata?.tileMetadataRenderer) return;
        if (!item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails) return;
        if (!item.tileRenderer.onSelectCommand?.watchEndpoint) return;
        const copiedItem = JSON.parse(JSON.stringify(item));
        const subtitleNode = copiedItem.tileRenderer.metadata.tileMetadataRenderer.lines?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text;
        if (!subtitleNode) return;
        const subtitle = subtitleNode;
        item.tileRenderer.onLongPressCommand = longPressData({
            videoId: copiedItem.tileRenderer.contentId,
            thumbnails: copiedItem.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails,
            title: copiedItem.tileRenderer.metadata.tileMetadataRenderer.title.simpleText,
            subtitle: subtitle.runs ? subtitle.runs[0].text : subtitle.simpleText,
            watchEndpointData: copiedItem.tileRenderer.onSelectCommand.watchEndpoint,
            item: copiedItem
        });
    });
}

function oracleHideVideo(items) {
    return items.filter(item => {
        if (!item.tileRenderer) return true;
        const progressBar = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays?.find(o => o.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer;
        if (!progressBar) return true;
        if (!configRead('enableHideWatchedVideos')) return true;
        const pages = configRead('hideWatchedVideosPages');
        if (!pages.length) return true;
        const hash = location.hash.substring(1);
        const pageName = hash === '/' ? 'home' : hash.startsWith('/search') ? 'search' : hash.split('?')[1]?.split('&')[0]?.split('=')[1]?.replace('FE', '')?.replace('topics_', '') ?? '';
        if (!pages.includes(pageName)) return true;
        return (progressBar.percentDurationWatched || 0) <= configRead('hideWatchedVideosThreshold');
    });
}

function oracleShelves(shelves) {
    const shorts = [];

    shelves.forEach((shelve) => {
        if (shelve.shelfRenderer) {
            if (!shelve.shelfRenderer.content?.horizontalListRenderer?.items) return;
            const list = shelve.shelfRenderer.content.horizontalListRenderer;
            oracleDeArrowify(list.items);
            oracleHqify(list.items);
            oracleAddLongPress(list.items);
            list.items = oracleHideVideo(list.items);
            if (!configRead('enableShorts')) {
                if (shelve.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') {
                    shorts.push(shelve);
                    return;
                }
                list.items = list.items.filter(i => i.tileRenderer?.tvhtml5ShelfRendererType !== 'TVHTML5_TILE_RENDERER_TYPE_SHORTS');
                list.items = list.items.filter(i => !i.tileRenderer?.onSelectCommand?.reelWatchEndpoint);
            }
        }
    });

    shorts.forEach((shelve) => shelves.splice(shelves.indexOf(shelve), 1));
}

function oracleTiles(items) {
    oracleDeArrowify(items);
    oracleHqify(items);
    oracleAddLongPress(items);
    return oracleHideVideo(items);
}

// -- fixtures ----------------------------------------------------------------------------------

const tile = (id, extra) => Object.assign({
    tileRenderer: Object.assign({
        contentId: id,
        style: 'TILE_STYLE_YTLR_DEFAULT',
        onSelectCommand: { watchEndpoint: { videoId: id } },
        metadata: {
            tileMetadataRenderer: {
                title: { simpleText: `title ${id}` },
                lines: [{ lineRenderer: { items: [{ lineItemRenderer: { text: { simpleText: `by ${id}` } } }] } }]
            }
        },
        header: {
            tileHeaderRenderer: {
                thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/hq.jpg?sqp=x`, width: 480, height: 360 }] }
            }
        }
    }, extra || {})
});

const watched = (id, percent) => {
    const made = tile(id);
    made.tileRenderer.header.tileHeaderRenderer.thumbnailOverlays = [
        { thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: percent } }
    ];
    return made;
};

const advert = () => ({ adSlotRenderer: { slot: 'x' } });

const shortTile = (id) => tile(id, { tvhtml5ShelfRendererType: 'TVHTML5_TILE_RENDERER_TYPE_SHORTS' });

const reelTile = (id) => tile(id, { onSelectCommand: { reelWatchEndpoint: { videoId: id } } });

const menuTile = (id) => tile(id, {
    onLongPressCommand: { showMenuCommand: { menu: { menuRenderer: { items: [{ existing: true }] } } } }
});

const shelf = (items, type) => ({
    shelfRenderer: Object.assign(
        { content: { horizontalListRenderer: { items } } },
        type ? { tvhtml5ShelfRendererType: type } : {}
    )
});

const SHORTS_SHELF = 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS';

// -- running -----------------------------------------------------------------------------------

const results = [];

const check = (name, run) => {
    try {
        run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${failure.message.split('\n').slice(0, 6).join('\n      ')}`);
    }
};

const copy = (value) => JSON.parse(JSON.stringify(value));

const withConfig = (settings, run) => {
    const before = Object.keys(settings).map((key) => [key, configRead(key)]);
    Object.keys(settings).forEach((key) => configWrite(key, settings[key]));
    try {
        run();
    } finally {
        before.forEach((entry) => configWrite(entry[0], entry[1]));
    }
};

const sameShelves = (name, shelves, settings) => check(name, () => {
    withConfig(settings || {}, () => {
        const mine = copy(shelves);
        const theirs = copy(shelves);
        walkShelves(mine, SHELF);
        oracleShelves(theirs);
        assert.deepStrictEqual(mine, theirs);
    });
});

const samePivot = (name, shelves, settings) => check(name, () => {
    withConfig(settings || {}, () => {
        const mine = copy(shelves);
        const theirs = copy(shelves);
        walkShelves(mine, PIVOT);
        oracleShelves(theirs);
        assert.deepStrictEqual(mine, theirs);
    });
});

const sameTiles = (name, items, settings) => check(name, () => {
    withConfig(settings || {}, () => {
        const mine = walkTiles(copy(items), TILES);
        const theirs = oracleTiles(copy(items));
        assert.deepStrictEqual(mine, theirs);
    });
});

const oracleGrid = (items) => {
    oracleDeArrowify(items);
    oracleHqify(items);
    oracleAddLongPress(items);
    const kept = oracleHideVideo(items);
    if (configRead('enableShorts')) return kept;

    return kept
        .filter((i) => i.tileRenderer?.tvhtml5ShelfRendererType !== 'TVHTML5_TILE_RENDERER_TYPE_SHORTS')
        .filter((i) => !i.tileRenderer?.onSelectCommand?.reelWatchEndpoint);
};

const sameGrid = (name, items, settings) => check(name, () => {
    withConfig(settings || {}, () => {
        const mine = walkTiles(copy(items), GRID);
        const theirs = oracleGrid(copy(items));
        assert.deepStrictEqual(mine, theirs);
    });
});

const ON = { enableHqThumbnails: true };

sameShelves('a plain shelf', [shelf([tile('a'), tile('b')])], ON);

// The reordering under test: advert removal used to happen before every dresser and is now a
// keeper that runs after. Sound only because no dresser touches an item without a tileRenderer.
sameShelves('an advert first in the shelf', [shelf([advert(), tile('a')])], ON);
sameShelves('two adjacent adverts', [shelf([advert(), advert(), tile('a')])], ON);
sameShelves('an advert last', [shelf([tile('a'), advert()])], ON);

// The bug the old comment recorded: splicing mid-walk let the second one through.
sameShelves('two adjacent shorts shelves', [
    shelf([tile('a')], SHORTS_SHELF),
    shelf([tile('b')], SHORTS_SHELF),
    shelf([tile('c')])
], ON);

sameShelves('a shorts shelf between two ordinary ones', [
    shelf([tile('a')]),
    shelf([tile('b')], SHORTS_SHELF),
    shelf([tile('c')])
], ON);

sameShelves('shorts tiles inside an ordinary shelf', [shelf([tile('a'), shortTile('s'), reelTile('r')])], ON);

sameShelves('shorts kept when the setting is on', [
    shelf([tile('a'), shortTile('s')], SHORTS_SHELF)
], Object.assign({}, ON, { enableShorts: true }));

sameShelves('a shelf with no items array', [{ shelfRenderer: {} }, shelf([tile('a')])], ON);
sameShelves('an entry that is not a shelf', [{ feedNudgeRenderer: {} }, shelf([tile('a')])], ON);

sameShelves('a tile that already has a long-press menu', [shelf([menuTile('m'), tile('a')])], ON);

sameShelves('watched tiles either side of the threshold', [
    shelf([watched('under', 50), watched('over', 95), tile('plain')])
], Object.assign({}, ON, {
    enableHideWatchedVideos: true,
    hideWatchedVideosPages: ['home'],
    hideWatchedVideosThreshold: 80
}));

sameShelves('watched tiles on a page that is not listed', [
    shelf([watched('over', 95), tile('plain')])
], Object.assign({}, ON, {
    enableHideWatchedVideos: true,
    hideWatchedVideosPages: ['search'],
    hideWatchedVideosThreshold: 80
}));

samePivot('the watch-next pivot is dressed like a shelf', [shelf([tile('a'), advert()])], ON);
samePivot('the pivot still drops shorts', [shelf([tile('a')], SHORTS_SHELF), shelf([tile('b')])], ON);

sameTiles('a horizontal continuation', [tile('a'), advert(), watched('w', 95)], ON);
sameTiles('a continuation keeps shorts tiles', [tile('a'), shortTile('s'), reelTile('r')], ON);

sameGrid('a grid is filtered like a shelf', [tile('a'), shortTile('s'), advert()], ON);
sameGrid('a grid with a menu tile', [menuTile('m'), tile('a')], ON);

// DeArrow is asked about every tile the walk dresses, including ones a later keeper drops —
// asking the keepers first would change how many requests leave the television. What changed in
// the rewrite is that the answer is remembered: the same video in a second shelf, or on the way
// back to the feed, is not asked about again.
check('deArrow asks about tiles that are later dropped', () => {
    withConfig({
        enableDeArrow: true,
        enableHideWatchedVideos: true,
        hideWatchedVideosPages: ['home'],
        hideWatchedVideosThreshold: 80
    }, () => {
        const items = [tile('asked-a'), watched('asked-b', 95)];

        fetches.calls = [];
        walkTiles(copy(items), TILES);

        assert.strictEqual(fetches.calls.length, 2,
            `both tiles should have been asked about, got ${fetches.calls.length}`);
    });
});

check('deArrow asks once per video, however many shelves carry it', () => {
    withConfig({ enableDeArrow: true }, () => {
        const items = [tile('repeated'), tile('repeated'), tile('other')];

        fetches.calls = [];
        walkTiles(copy(items), TILES);
        walkTiles(copy(items), TILES);

        const distinct = new Set(fetches.calls);
        assert.strictEqual(distinct.size, 2, 'two videos, so two distinct requests');
        assert.strictEqual(fetches.calls.length, 2,
            `asked ${fetches.calls.length} times for 2 videos across 6 tiles — the cache is not holding`);
    });
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
