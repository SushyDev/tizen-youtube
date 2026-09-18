const API = 'https://returnyoutubedislikeapi.com/votes';

// A response carrying traceId is an error, not an answer — from having asked for something
// invalid or been rate limited.
const fetchCount = (videoID) => fetch(`${API}?videoId=${videoID}`)
    .then((res) => res.json())
    .then((data) => (data && typeof data.dislikes === 'number' && !('traceId' in data) ? data.dislikes : null));

// YouTube's own like count is rounded down before it is made compact — 79571 reads as 79K, not
// 80K — so a dislike count sitting next to it is rounded the same way.
const roundedDown = (n) => {
    if (n < 1000) return n;

    const magnitude = Math.floor(Math.log10(n) - 2);
    const step = magnitude + (magnitude % 3 ? 1 : 0);
    return Math.floor(n / 10 ** step) * 10 ** step;
};

// Intl does not exist on this engine, confirmed live (a bare `Intl.NumberFormat` throws
// ReferenceError: Intl is not defined) — so the K/M suffix is built by hand instead.
const TIERS = [{ value: 1e9, suffix: 'B' }, { value: 1e6, suffix: 'M' }, { value: 1e3, suffix: 'K' }];

const compact = (n) => {
    const rounded = roundedDown(n);
    const tier = TIERS.find((candidate) => rounded >= candidate.value);
    if (!tier) return String(rounded);

    const scaled = rounded / tier.value;
    return (Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1)) + tier.suffix;
};

export { fetchCount, compact };
