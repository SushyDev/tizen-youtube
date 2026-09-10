import {
    DEV_TOOLS, GRID, PIVOT, SHELF, TILES, onResponse, walkShelves, walkTiles
} from '../../framework/index.js';

// The only file that knows where YouTube keeps its tiles.
//
// A table rather than a wall of ifs, because the table is the thing that goes wrong: a surface
// missing from it is not an error anywhere, it is the feed quietly going out undressed. That is
// exactly what happened to the Refresh button at the foot of the home page — its 401KB of tiles
// arrive under `tvSurfaceContentContinuation`, which was not listed here, so adverts and shorts
// came back and nothing said a word. Anything that acts on a tile or a row registers a visitor
// with the walk and never comes here; this is the descent, and nothing else.

const browse = (r) => r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content;

// Pressing Refresh answers under its own continuation name. The grid alongside it mirrors the
// browse surface above; it has not been seen on the set, but the shape is the same one.
const refreshed = (r) => r?.continuationContents?.tvSurfaceContentContinuation?.content;

const shelvesAt = (contents, surface) => {
    if (!contents) return false;
    walkShelves(contents, surface);
    return true;
};

const tilesAt = (holder, surface) => {
    if (!holder?.items) return false;
    holder.items = walkTiles(holder.items, surface);
    return true;
};

// The subscriptions page: each channel is a tab carrying its own surface. The tabs themselves are
// left in the three groups YouTube sends — "All", the channels with something new, an "A-Z"
// divider, then every channel — because sorting them together made a channel that is legitimately
// in two of those groups look like a duplicate.
const subscriptionTabs = (r) => {
    const sections = r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections;
    if (!sections) return false;

    sections.forEach((entry) => {
        const section = entry.tvSecondaryNavSectionRenderer;
        if (!section || !section.tabs) return;

        section.tabs.forEach((tab) => {
            const content = tab.tabRenderer.content?.tvSurfaceContentRenderer?.content;
            shelvesAt(content?.sectionListRenderer?.contents, SHELF);
            tilesAt(content?.gridRenderer, GRID);
        });
    });

    return true;
};

const DESCENTS = [
    (r) => shelvesAt(browse(r)?.sectionListRenderer?.contents, SHELF),
    (r) => tilesAt(browse(r)?.gridRenderer, GRID),
    (r) => shelvesAt(r?.contents?.sectionListRenderer?.contents, SHELF),
    (r) => shelvesAt(r?.continuationContents?.sectionListContinuation?.contents, SHELF),
    (r) => tilesAt(r?.continuationContents?.horizontalListContinuation, TILES),
    (r) => tilesAt(r?.continuationContents?.gridContinuation, GRID),
    (r) => shelvesAt(refreshed(r)?.sectionListRenderer?.contents, SHELF),
    (r) => tilesAt(refreshed(r)?.gridRenderer, GRID),
    subscriptionTabs,
    (r) => shelvesAt(r?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer?.contents, PIVOT)
];

// A response carrying tiles that nothing above matched is a surface we do not know about. Silent
// in a release build; in a dev build it names itself, which is the alarm that was missing.
const CARRIES_TILES = /"(tileRenderer|shelfRenderer|adSlotRenderer)"/;

const reportUnwalked = (r) => {
    const text = JSON.stringify(r);
    if (!CARRIES_TILES.test(text)) return;

    console.warn('[feed] tiles arrived on a surface nothing descends into —'
        + ` ${Math.round(text.length / 1024)}KB, keys: ${Object.keys(r).join(' ')}.`
        + ' Add the descent to mods/feed/surfaces.js.');
};

onResponse('feed surfaces', ['contents', 'continuationContents'], (r) => {
    const matched = DESCENTS.filter((descend) => descend(r)).length;

    if (DEV_TOOLS && !matched) reportUnwalked(r);
});
