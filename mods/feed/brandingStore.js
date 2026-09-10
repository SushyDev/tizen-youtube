// What DeArrow has already said, remembered across launches.
//
// This is what makes DeArrow work at all. The answer arrives from the network, but a tile is
// dressed inside JSON.parse — synchronously, before the object goes back to the app — so an answer
// that has not arrived yet is an answer that cannot be applied. Held only in memory, the store was
// empty at every launch, so every video on the first home feed was a miss and nothing was dressed.
// It appeared to work only after the same video came round a second time in one session.
//
// Kept on disk, a video seen in any previous session is dressed on sight. Only the first-ever
// sighting is still missed, and that one corrects itself the next time the feed is drawn.

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

    held.entries = Object.keys(stored).reduce((kept, videoID) => {
        if (fresh(stored[videoID], now)) kept[videoID] = stored[videoID];
        return kept;
    }, {});
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

// Oldest out first. Dropping the lot on overflow would throw away a warm store to make room for
// one entry, which is what the in-memory version did.
const evict = () => {
    const videoIDs = Object.keys(held.entries);
    if (videoIDs.length <= REMEMBERED) return;

    videoIDs
        .sort((one, two) => held.entries[one].at - held.entries[two].at)
        .slice(0, videoIDs.length - REMEMBERED)
        .forEach((videoID) => { delete held.entries[videoID]; });
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
