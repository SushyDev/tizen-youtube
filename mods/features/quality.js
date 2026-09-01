// YouTube names qualities with constants ('hd1080', 'hd2160') and labels them with
// numbers ('1080p'). Asking for one the video does not have is not reported — the player
// just keeps what it had — so every answer comes from the list it offers.
//
// Exported and free of the player so the choice can be tested directly; the height comes
// back with it because the caller has to know whether a later list beats an earlier one.
export function chooseQuality(preference, offered) {
    // An entry the player has said it cannot play is not an answer, whichever way the
    // preference points.
    const available = (offered || []).filter((entry) => entry && entry.isPlayable !== false);
    if (!available.length) return null;

    const pixels = (entry) => parseInt(entry.qualityLabel, 10) || 0;

    // 'highest' is an instruction, not a resolution: the top of whatever this video
    // offers. Unlike naming a resolution, it cannot silently do nothing.
    if (preference === 'highest') {
        const best = available.reduce((top, entry) => (pixels(entry) > pixels(top) ? entry : top));
        return { quality: best.quality, pixels: pixels(best) };
    }

    const target = parseInt(preference, 10) || 0;
    const match = available.find((entry) => pixels(entry) === target);

    // The nearest below beats falling back to the maximum, which would be the opposite
    // of what a resolution cap is for.
    if (match) return { quality: match.quality, pixels: pixels(match) };

    const below = available
        .filter((entry) => pixels(entry) <= target)
        .reduce((best, entry) => (!best || pixels(entry) > pixels(best) ? entry : best), null);

    return below ? { quality: below.quality, pixels: pixels(below) } : null;
}
