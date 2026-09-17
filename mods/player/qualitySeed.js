import { configRead } from '../../framework/index.js';

// Relies on running before kabuki's script.

const QUALITY = 'preferredVideoQuality';

// YouTube's envelope: the value is a JSON string under `data`, with `creation` and `expiration`
// beside it.
const BANDWIDTH_KEY = 'yt-player-bandwidth';
const CEILING_KEY = 'yt-player-quality';

// Bytes per second; `highest` has no rung to pin until its ladder arrives, so until then it is
// told the link is larger than any stream could use.
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

// Written every time: the player saves its own measurement back over the bandwidth key as each
// video ends.
const seedPreferredQuality = () => {
    const preference = configRead(QUALITY);
    if (!preference || preference === 'auto') return;

    try {
        remember(BANDWIDTH_KEY, {
            byterate: preference === 'highest' ? UNCAPPED_BYTES_PER_SECOND : SEEDED_BYTES_PER_SECOND
        });

        // A stored zero is how the player spells no ceiling, and the ceiling only caps the range
        // it may choose within rather than pinning a rung.
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
