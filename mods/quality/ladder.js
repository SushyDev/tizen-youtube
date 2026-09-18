// The player's own rung names, so a preference can be pinned before any ladder exists.
const NAMED = {
    2160: 'hd2160', 1440: 'hd1440', 1080: 'hd1080', 720: 'hd720',
    480: 'large', 360: 'medium', 240: 'small', 144: 'tiny'
};

const pixels = (entry) => parseInt(entry.qualityLabel, 10) || 0;

const highestOf = (available) => {
    const best = available.reduce((top, entry) => (pixels(entry) > pixels(top) ? entry : top));
    return best.quality;
};

const nearestBelow = (available, target) => {
    const below = available
        .filter((entry) => pixels(entry) <= target)
        .reduce((best, entry) => (!best || pixels(entry) > pixels(best) ? entry : best), null);

    return below ? below.quality : null;
};

export function chooseQuality(preference, offered) {
    const available = (offered || []).filter((entry) => entry && entry.isPlayable !== false);
    if (!available.length) return null;

    if (preference === 'highest') return highestOf(available);

    const target = parseInt(preference, 10) || 0;
    const match = available.find((entry) => pixels(entry) === target);

    return match ? match.quality : nearestBelow(available, target);
}

export { NAMED };
