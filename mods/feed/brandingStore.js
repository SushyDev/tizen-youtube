// DeArrow's answers kept in localStorage, because a tile is dressed synchronously inside
// JSON.parse and cannot wait for the network.

const KEY = 'tube.dearrow';

// Enough for a deep scroll of the home feed and several videos' suggestions, and about 40KB of
// localStorage at that size.
const REMEMBERED = 512;

// DeArrow submissions change as people vote. A month is long enough that the store is warm and
// short enough that a title corrected upstream is not kept for ever.
const KEPT_FOR = 30 * 86400000;

const read = () => {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
        return {};
    }
};

const fresh = (entry, now) => entry && typeof entry.at === 'number' && now - entry.at < KEPT_FOR;

const held = { entries: {}, dirty: false, writing: null };

const load = () => {
    const now = Date.now();
    const stored = read();

    held.entries = Object.assign({}, ...Object.keys(stored)
        .filter((videoID) => fresh(stored[videoID], now))
        .map((videoID) => ({ [videoID]: stored[videoID] })));
};

// Written on a short timer rather than per answer: one feed response yields dozens of answers
// within a few milliseconds of each other, and a localStorage write is synchronous on the main
// thread. Long enough to batch a whole response, short enough that a set pulled from the wall
// loses at most the last quarter second.
const WRITE_AFTER = 250;

const flush = () => {
    held.writing = null;
    if (!held.dirty) return;
    held.dirty = false;

    try {
        window.localStorage.setItem(KEY, JSON.stringify(held.entries));
    } catch (e) {
        // A full or unavailable store costs the cache, not the feed.
    }
};

const scheduleFlush = () => {
    if (held.writing) return;
    held.writing = setTimeout(flush, WRITE_AFTER);
};

// Oldest out first: dropping the lot on overflow would throw away a warm store for one entry.
const evict = () => {
    const videoIDs = Object.keys(held.entries);
    if (videoIDs.length <= REMEMBERED) return;

    const oldest = videoIDs
        .slice()
        .sort((one, two) => held.entries[one].at - held.entries[two].at)
        .slice(0, videoIDs.length - REMEMBERED);

    held.entries = Object.assign({}, ...videoIDs
        .filter((videoID) => oldest.indexOf(videoID) === -1)
        .map((videoID) => ({ [videoID]: held.entries[videoID] })));
};

// undefined for a video never asked about, null for one DeArrow has nothing to say about.
const brandingOf = (videoID) => {
    const entry = held.entries[videoID];
    if (entry === undefined) return undefined;

    return entry.title || entry.timestamp !== null ? { title: entry.title, timestamp: entry.timestamp } : null;
};

const remember = (videoID, best) => {
    held.entries[videoID] = {
        title: (best && best.title) || null,
        timestamp: (best && typeof best.timestamp === 'number') ? best.timestamp : null,
        at: Date.now()
    };

    held.dirty = true;
    evict();
    scheduleFlush();
};

load();

export { brandingOf, remember, KEY, REMEMBERED };
