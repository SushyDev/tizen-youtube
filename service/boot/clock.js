const now = () => (window.performance && window.performance.now ? window.performance.now() : Date.now());

const started = now();

export const elapsed = () => now() - started;

// dmesg's [    1.234567].
export const stamp = () => `[${(elapsed() / 1000).toFixed(6).padStart(12)}] `;

// How long ago a wall-clock time was, roughly.
export const ago = (at) => {
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));

    if (seconds < 120) return `${seconds}s`;
    return seconds < 7200 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`;
};
