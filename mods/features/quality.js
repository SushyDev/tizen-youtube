// Which rung a preference resolves to. The player never reports a rung it cannot give,
// so the answer only ever comes from the list on offer.
export function chooseQuality(preference, offered) {
    // An unplayable entry is not an answer.
    const available = (offered || []).filter((entry) => entry && entry.isPlayable !== false);
    if (!available.length) return null;

    const pixels = (entry) => parseInt(entry.qualityLabel, 10) || 0;

    // 'highest' is an instruction, not a resolution, so it cannot silently do nothing.
    if (preference === 'highest') {
        const best = available.reduce((top, entry) => (pixels(entry) > pixels(top) ? entry : top));
        return { quality: best.quality, pixels: pixels(best) };
    }

    const target = parseInt(preference, 10) || 0;
    const match = available.find((entry) => pixels(entry) === target);

    // Nearest below, since falling back to the maximum defeats a cap.
    if (match) return { quality: match.quality, pixels: pixels(match) };

    const below = available
        .filter((entry) => pixels(entry) <= target)
        .reduce((best, entry) => (!best || pixels(entry) > pixels(best) ? entry : best), null);

    return below ? { quality: below.quality, pixels: pixels(below) } : null;
}

// Whether to ask the player for a rung now. Asking restarts the stream, so a rung it
// will not take is asked for a few times and then left alone until the next video.
export function shouldAsk({ current, wanted, target, attempts, askedAt }, now, limits) {
    if (!wanted || current === wanted) return false;

    const again = wanted === target;
    if (again && attempts >= limits.maxAttempts) return false;
    if (again && now - askedAt < limits.retryDelay) return false;

    return true;
}
