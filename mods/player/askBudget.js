// How often the player may be asked to change rung.
//
// Asking restarts a running stream, so this is a budget rather than a check: one ask before the
// first frame, one to correct it once the real ladder arrives, and never a third. A rung the
// player declines twice is a rung it is not going to take, and pressing it again only stutters
// the video for a viewer who can see perfectly well what is playing.

const LIMITS = { maxAttempts: 2, retryDelay: 5000 };

export function shouldAsk({ current, wanted, again, attempts, askedAt }, now, limits) {
    if (!wanted || current === wanted) return false;

    // A different rung than last time is a fresh question, so it starts with a fresh budget.
    if (again && attempts >= limits.maxAttempts) return false;
    if (again && now - askedAt < limits.retryDelay) return false;

    return true;
}

export { LIMITS };
