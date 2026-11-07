const now = () => (window.performance && window.performance.now ? window.performance.now() : Date.now());

const CARRY = 'tube.boot.carry';

// A reread of this page carries on the clock of the load before it.
const carried = () => {
    try {
        const kept = JSON.parse(window.localStorage.getItem(CARRY) || 'null');
        window.localStorage.removeItem(CARRY);
        return kept && Date.now() - kept.at < 10000 ? Math.max(0, kept.elapsed + Date.now() - kept.at) : 0;
    } catch (e) {
        return 0;
    }
};

const loaded = now();
const started = loaded - carried();

export const elapsed = () => now() - started;

export const sinceLoad = () => now() - loaded;

export const carryOver = () => {
    try {
        window.localStorage.setItem(CARRY, JSON.stringify({ at: Date.now(), elapsed: elapsed() }));
        return true;
    } catch (e) {
        return false;
    }
};

// dmesg's [    1.234567].
export const stamp = () => `[${(elapsed() / 1000).toFixed(6).padStart(12)}] `;

export const ago = (at) => {
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));

    if (seconds < 120) return `${seconds}s`;
    return seconds < 7200 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`;
};
