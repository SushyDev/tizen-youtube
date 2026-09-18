import { GRID, PIVOT, SHELF, TILES, configRead, keepShelf, keepTile } from '../../framework/index.js';

const SHORTS_SHELF = 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS';
const SHORTS_TILE = 'TVHTML5_TILE_RENDERER_TYPE_SHORTS';

// Search results carry shorts as lockupViewModel, not tileRenderer.
const SHORTS_LOCKUP = 'LOCKUP_CONTENT_TYPE_SHORT';

const wanted = () => configRead('enableShorts');

keepTile('shorts tiles', [SHELF, PIVOT, TILES, GRID], (item) => {
    if (wanted()) return true;

    if (item.lockupViewModel?.contentType === SHORTS_LOCKUP) return false;
    if (item.tileRenderer?.tvhtml5ShelfRendererType === SHORTS_TILE) return false;

    return !item.tileRenderer?.onSelectCommand?.reelWatchEndpoint;
});

// A section list holds entries that are not shelves, such as an advert slot with no shelfRenderer.
keepShelf('shorts shelves', [SHELF, PIVOT], (shelf) =>
    wanted() || shelf.shelfRenderer?.tvhtml5ShelfRendererType !== SHORTS_SHELF);
