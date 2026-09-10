// Which rung a preference means.
//
// The ladder is per video and arrives with the player response, so this answers from whatever was
// offered rather than from a fixed list: a preference of 1440p on a video that stops at 1080p is
// 1080p, not nothing. Pure, and asked once per response.

// The player's own names for the rungs. A named preference can be pinned through these before any
// ladder exists, which is the only moment early enough to be sure the first segment fetched is the
// right one. `highest` cannot be pinned that way — which rung is highest is not known until the
// response lists them.
const NAMED = {
    2160: 'hd2160', 1440: 'hd1440', 1080: 'hd1080', 720: 'hd720',
    480: 'large', 360: 'medium', 240: 'small', 144: 'tiny'
};

const pixels = (entry) => parseInt(entry.qualityLabel, 10) || 0;

const highestOf = (available) => {
    const best = available.reduce((top, entry) => (pixels(entry) > pixels(top) ? entry : top));
    return best.quality;
};

// Nearest at or below the target, never above it: a viewer who asked for 1080p on a link that can
// carry more asked for less, and answering 2160p would be answering a different question.
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
