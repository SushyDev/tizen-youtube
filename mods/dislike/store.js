// Cached in localStorage since a response is dressed synchronously inside JSON.parse, before any fetch could return.

const KEY = 'tube.dislikes';

// About 12KB of localStorage at this size.
const REMEMBERED = 512;

// A vote count keeps moving as people vote, so a day is long enough to trust a cached one.
const KEPT_FOR = 86400000;

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

// Debounced since a localStorage write is synchronous on the main thread and would block on every answer.
const WRITE_AFTER = 250;

const flush = () => {
    held.writing = null;
    if (!held.dirty) return;
    held.dirty = false;

    try {
        window.localStorage.setItem(KEY, JSON.stringify(held.entries));
    } catch (e) {
        // A full or unavailable store costs the cache, not the player.
    }
};

const scheduleFlush = () => {
    if (held.writing) return;
    held.writing = setTimeout(flush, WRITE_AFTER);
};

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

// undefined for a video never asked about.
const dislikesOf = (videoID) => {
    const entry = held.entries[videoID];
    return entry === undefined ? undefined : entry.dislikes;
};

const remember = (videoID, dislikes) => {
    held.entries[videoID] = { dislikes, at: Date.now() };

    held.dirty = true;
    evict();
    scheduleFlush();
};

load();

export { dislikesOf, remember, KEY, REMEMBERED };
