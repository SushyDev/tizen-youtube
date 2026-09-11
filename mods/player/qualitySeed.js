import { configRead } from '../../framework/index.js';

// Seeds the player's stored bandwidth estimate so the first rung is right; relies on running
// before kabuki's script.

const QUALITY = 'preferredVideoQuality';

// YouTube's own keys, in YouTube's own envelope: the value is a JSON string under `data`, with
// `creation` and `expiration` beside it.
const BANDWIDTH_KEY = 'yt-player-bandwidth';
const CEILING_KEY = 'yt-player-quality';

// Bytes per second. A named rung is pinned by the watcher as well, so its estimate need only be
// plausible. `highest` has nothing else forcing its hand, so it is told the link is larger than
// any stream could use — ABR measures the truth within a segment or two either way.
const SEEDED_BYTES_PER_SECOND = 6250000;
const UNCAPPED_BYTES_PER_SECOND = 1250000000;
const REMEMBERED_FOR_MS = 30 * 24 * 60 * 60 * 1000;

const remember = (key, value) => {
    const now = Date.now();

    window.localStorage.setItem(key, JSON.stringify({
        data: JSON.stringify(value),
        expiration: now + REMEMBERED_FOR_MS,
        creation: now
    }));
};

// Written every time rather than once: the player saves its own measurement back over the
// bandwidth key as each video ends, so a value written once would decide the first video and
// nothing after it.
const seedPreferredQuality = () => {
    const preference = configRead(QUALITY);
    if (!preference || preference === 'auto') return;

    try {
        remember(BANDWIDTH_KEY, {
            byterate: preference === 'highest' ? UNCAPPED_BYTES_PER_SECOND : SEEDED_BYTES_PER_SECOND
        });

        // `highest` wants no ceiling, and a stored zero is how the player spells that. The ceiling
        // is only the top of the range it may choose within, not a target, so it cannot pin a rung
        // on its own — that is what the estimate above is for.
        const height = parseInt(preference, 10) || 0;
        remember(CEILING_KEY, { quality: height, previousQuality: height });
    } catch (e) {
        console.warn('[tube] could not seed the preferred quality:', e);
    }
};

const liftCeiling = () => {
    try {
        remember(CEILING_KEY, { quality: 0, previousQuality: 0 });
    } catch (e) {
        console.warn('[tube] could not lift the quality ceiling:', e);
    }
};

export { QUALITY, liftCeiling, seedPreferredQuality };
