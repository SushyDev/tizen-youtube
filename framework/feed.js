// One walk of the feed that every tile and shelf visitor registers against.

// A visitor names the surfaces it wants because they differ: a horizontal continuation keeps its
// shorts tiles.
const SHELF = 'shelf';
const PIVOT = 'pivot';
const TILES = 'tiles';
const GRID = 'grid';

const registry = { tile: [], keepTile: [], shelf: [], keepShelf: [] };

const memo = { held: Object.create(null) };

const add = (bucket, name, surfaces, run) => {
    registry[bucket] = registry[bucket].concat([{ name, surfaces, run }]);
    memo.held = Object.create(null);
};

const forSurface = (bucket, surface) => {
    const key = `${bucket} ${surface}`;
    if (memo.held[key]) return memo.held[key];

    memo.held[key] = registry[bucket].filter((entry) => entry.surfaces.indexOf(surface) !== -1);
    return memo.held[key];
};

// YouTube's shapes change without notice, and a feed half-dressed beats a feed not rendered.
const guarded = (entry, run, fallback) => {
    try {
        return run();
    } catch (failure) {
        console.error(`[feed:${entry.name}] failed:`, failure);
        return fallback;
    }
};

const onTile = (name, surfaces, dress) => add('tile', name, surfaces, dress);
const keepTile = (name, surfaces, decide) => add('keepTile', name, surfaces, decide);
const onShelf = (name, surfaces, dress) => add('shelf', name, surfaces, dress);
const keepShelf = (name, surfaces, decide) => add('keepShelf', name, surfaces, decide);

// Dressers run before keepers so a dresser's side effects still happen for tiles a keeper drops.
const walkTiles = (items, surface, at) => {
    const dressers = forSurface('tile', surface);
    const keepers = forSurface('keepTile', surface);

    if (!dressers.length && !keepers.length) return items;

    return items.filter((item) => {
        dressers.forEach((entry) => guarded(entry, () => entry.run(item, at)));

        return keepers.every((entry) => guarded(entry, () => entry.run(item, at), true));
    });
};

const itemsOf = (shelf) => (shelf.shelfRenderer
    && shelf.shelfRenderer.content
    && shelf.shelfRenderer.content.horizontalListRenderer
    && shelf.shelfRenderer.content.horizontalListRenderer.items) || null;

const walkShelves = (shelves, surface) => {
    const dressers = forSurface('shelf', surface);
    const keepers = forSurface('keepShelf', surface);

    shelves.forEach((shelf) => {
        const items = itemsOf(shelf);
        if (!items) return;

        const at = { surface, shelf };
        shelf.shelfRenderer.content.horizontalListRenderer.items = walkTiles(items, surface, at);

        dressers.forEach((entry) => guarded(entry, () => entry.run(shelf, at)));
    });

    const doomed = shelves.filter((shelf) => itemsOf(shelf)
        && !keepers.every((entry) => guarded(entry, () => entry.run(shelf, { surface, shelf }), true)));

    // Splicing during the walk skips whatever followed each removal, so two adjacent shorts shelves
    // left the second one on screen. Collect them and take them out afterwards.
    doomed.forEach((shelf) => shelves.splice(shelves.indexOf(shelf), 1));
};

export { SHELF, PIVOT, TILES, GRID, onTile, keepTile, onShelf, keepShelf, walkTiles, walkShelves };
