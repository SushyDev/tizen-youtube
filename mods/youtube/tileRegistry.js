import { cloneJson } from '../utils/clone.js';

// Which tile a long-press menu belongs to, kept beside the menu rather than inside it.
//
// The queue needs a whole tile, because it renders its entries as a shelf of real ones.
// The old design therefore deep-cloned every tile of every shelf at parse time and
// embedded the copy in that tile's own menu, on the chance that one of them would be
// queued later. A CPU profile put a quarter of the userscript's time in those clones,
// and embedding a tile inside itself is also what made the response circular the moment
// the clone was taken a step later.
//
// Nothing is embedded now. The menu command is the key and the tile is the value, so
// the snapshot is taken once, for one tile, at the moment somebody opens its menu —
// which is human-speed work rather than render-speed work.
//
// The link is a symbol-keyed property on the command rather than a map entry. A WeakMap
// was the obvious choice and measured badly: 180 inserts per response put 6.6% of the
// profile in the insert itself and took the garbage collector from 5% to 21%, because
// ephemeron tables are expensive to mark. It cost more than the clone it was replacing.
//
// A symbol key is a plain property assignment, and it is invisible in exactly the ways
// that matter: JSON.stringify ignores it, so the response stays serialisable and no
// cycle can form; `for...in` ignores it, so `cloneJson` never follows it back to the
// tile; and Object.keys ignores it, so nothing in YouTube's own code will trip over it.
// It dies with the command object, so there is still nothing to clean up.
const OWNER = typeof Symbol === 'function' ? Symbol('tube.tile') : '__tubeTile';

/** Notes that `command` opens the menu for `item`. */
export function rememberTile(command, item) {
    if (command && item) command[OWNER] = item;
}

/** The tile whose menu `command` opens, if this app registered one. */
export function tileFor(command) {
    return command ? command[OWNER] : undefined;
}

/**
 * What the queue keeps about a tile.
 *
 * Never the tile's own long-press menu: a queued entry has no use for it, it is the
 * subtree this app mutates, and including it is what would make the snapshot contain
 * itself. Dropping it is also most of what made the clone expensive.
 */
export function snapshotTile(item) {
    const snapshot = {};

    for (const key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        if (key !== 'tileRenderer') {
            snapshot[key] = cloneJson(item[key]);
            continue;
        }

        const tile = {};
        for (const field in item.tileRenderer) {
            if (!Object.prototype.hasOwnProperty.call(item.tileRenderer, field)) continue;
            if (field === 'onLongPressCommand') continue;
            tile[field] = cloneJson(item.tileRenderer[field]);
        }
        snapshot.tileRenderer = tile;
    }

    return snapshot;
}
