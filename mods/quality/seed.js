import { configRead } from '../../framework/index.js';

// Relies on running before kabuki's script.

const QUALITY = 'preferredVideoQuality';

// YouTube's envelope: the value is a JSON string under `data`, with `creation` and `expiration`
// beside it.
const CEILING_KEY = 'yt-player-quality';

const REMEMBERED_FOR_MS = 30 * 24 * 60 * 60 * 1000;

const remember = (key, value) => {
    const now = Date.now();

    window.localStorage.setItem(key, JSON.stringify({
        data: JSON.stringify(value),
        expiration: now + REMEMBERED_FOR_MS,
        creation: now
    }));
};

// Written every time: each ask makes the player write its own value over the key.
const seedPreferredQuality = () => {
    const preference = configRead(QUALITY);
    if (!preference || preference === 'auto') return;

    try {
        // A stored zero is how the player spells no ceiling. The link is left to the player's own
        // measurement, so a slow one is never told it is fast.
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
