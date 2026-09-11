export function chooseQuality(preference, offered) {
    const available = (offered || []).filter((entry) => entry && entry.isPlayable !== false);
    if (!available.length) return null;

    const pixels = (entry) => parseInt(entry.qualityLabel, 10) || 0;

    if (preference === 'highest') {
        const best = available.reduce((top, entry) => (pixels(entry) > pixels(top) ? entry : top));
        return best.quality;
    }

    const target = parseInt(preference, 10) || 0;
    const match = available.find((entry) => pixels(entry) === target);

    if (match) return match.quality;

    const below = available
        .filter((entry) => pixels(entry) <= target)
        .reduce((best, entry) => (!best || pixels(entry) > pixels(best) ? entry : best), null);

    return below ? below.quality : null;
}

export function shouldAsk({ current, wanted, again, attempts, askedAt }, now, limits) {
    if (!wanted || current === wanted) return false;

    if (again && attempts >= limits.maxAttempts) return false;
    if (again && now - askedAt < limits.retryDelay) return false;

    return true;
}
