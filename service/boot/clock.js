const now = () => (window.performance && window.performance.now ? window.performance.now() : Date.now());

const started = now();

export const elapsed = () => now() - started;

// dmesg's [    1.234567].
export const stamp = () => `[${(elapsed() / 1000).toFixed(6).padStart(12)}] `;
