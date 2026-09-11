// At most LIMITS.maxAttempts asks per rung, LIMITS.retryDelay apart, because each ask restarts
// the stream.

const LIMITS = { maxAttempts: 2, retryDelay: 5000 };

export function shouldAsk({ current, wanted, again, attempts, askedAt }, now, limits) {
    if (!wanted || current === wanted) return false;

    // A different rung than last time is a fresh question, so it starts with a fresh budget.
    if (again && attempts >= limits.maxAttempts) return false;
    if (again && now - askedAt < limits.retryDelay) return false;

    return true;
}

export { LIMITS };
