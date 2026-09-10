import { GRID, PIVOT, SHELF, TILES, configRead, keepShelf, keepTile } from '../../framework/index.js';

// Shorts, in all three places they arrive: a shelf of them, a single tile among ordinary videos,
// and a tile whose select command opens the reel player rather than the watch page.
//
// All four surfaces, TILES included. It used to name three, so a row that mixes shorts with
// ordinary videos filtered the tiles it was drawn with and then let every short through as soon
// as scrolling right loaded more — the same row, half filtered, depending only on how far along
// it you were.

const SHORTS_SHELF = 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS';
const SHORTS_TILE = 'TVHTML5_TILE_RENDERER_TYPE_SHORTS';

// The second renderer family. Search results carry no tileRenderer at all — 122 lockups and zero
// tiles in a 1487KB response, read off the set — so a visitor that only knows tiles declines every
// one of them and the whole page goes out unfiltered. The walk reaches these items already; it is
// the shape inside that was unrecognised.
const SHORTS_LOCKUP = 'LOCKUP_CONTENT_TYPE_SHORT';

const wanted = () => configRead('enableShorts');

keepTile('shorts tiles', [SHELF, PIVOT, TILES, GRID], (item) => {
    if (wanted()) return true;

    if (item.lockupViewModel?.contentType === SHORTS_LOCKUP) return false;
    if (item.tileRenderer?.tvhtml5ShelfRendererType === SHORTS_TILE) return false;

    return !item.tileRenderer?.onSelectCommand?.reelWatchEndpoint;
});

// Optional, because a section list holds entries that are not shelves — an advert slot has no
// shelfRenderer to read a type off.
keepShelf('shorts shelves', [SHELF, PIVOT], (shelf) =>
    wanted() || shelf.shelfRenderer?.tvhtml5ShelfRendererType !== SHORTS_SHELF);
