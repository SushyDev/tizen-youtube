// One walk of the feed, and everything that wants a tile registers against it.
//
// Five features used to take their own pass over the same item array — eight traversals per shelf
// — and the walk was entered from nine places in adblock.js, the file that happened to already
// hold a tileRenderer. None of that was a decision; it was where the code could reach a tile.
//
// A visitor names the surfaces it wants because the nine entries are not interchangeable: a grid
// carries no previews and no shorts filtering, and the watch-next pivot carries no previews. That
// table was encoded in which helper each call site happened to call; here it is written down.

const SHELF = 'shelf';
const PIVOT = 'pivot';
const TILES = 'tiles';
const GRID = 'grid';

const registry = { tile: [], keepTile: [], shelf: [], keepShelf: [] };

// A response carries many arrays, and filtering the registry per surface for each one is the cost
// this file exists to remove. Thrown away whenever a registration arrives, which is at import.
const memo = { held: Object.create(null) };

const add = (bucket, name, surfaces, run) => {
    registry[bucket].push({ name, surfaces, run });
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

// Dress every tile, then ask about every tile — never interleaved. Two things depend on that
// order. Advert slots used to be spliced out before any dresser ran and are now a keeper that runs
// after, which is only sound because every dresser already declines an item with no tileRenderer,
// and an adSlotRenderer has none. And DeArrow still fires for tiles a later keeper drops, exactly
// as it did when the fetch went out before hideVideo — asking first would change how many requests
// leave the television.
const walkTiles = (items, surface, at) => {
    const dressers = forSurface('tile', surface);
    const keepers = forSurface('keepTile', surface);

    if (!dressers.length && !keepers.length) return items;

    return items.filter((item) => {
        dressers.forEach((entry) => guarded(entry, () => entry.run(item, at)));

        // every(), so the keepers compose into one predicate. Sound only because each is pure:
        // the first false ends the questioning and the rest are never asked.
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
    const doomed = [];

    shelves.forEach((shelf) => {
        const items = itemsOf(shelf);
        if (!items) return;

        const at = { surface, shelf };
        shelf.shelfRenderer.content.horizontalListRenderer.items = walkTiles(items, surface, at);

        dressers.forEach((entry) => guarded(entry, () => entry.run(shelf, at)));

        if (!keepers.every((entry) => guarded(entry, () => entry.run(shelf, at), true))) {
            doomed.push(shelf);
        }
    });

    // Splicing during the walk skips whatever followed each removal, so two adjacent shorts shelves
    // left the second one on screen. Collect them and take them out afterwards.
    doomed.forEach((shelf) => shelves.splice(shelves.indexOf(shelf), 1));
};

export { SHELF, PIVOT, TILES, GRID, onTile, keepTile, onShelf, keepShelf, walkTiles, walkShelves };
