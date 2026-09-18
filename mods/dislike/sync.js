// A trailing debounce that coalesces presses — at most one submission in flight per video, chasing the latest value.
import { dislikesOf, remember } from './store.js';
import { submitVote } from './vote.js';

// Long enough to outlast a rapid run of presses, short enough that a single press still feels immediate.
const SETTLE_AFTER = 500;

const RETRY_STARTING_AT = 1000;
const RETRY_CAPPED_AT = 15000;

// Per video: `desired` is the latest wanted value, `basis` the value already folded into the display.
const tracked = Object.create(null);

const stateFor = (videoId) => {
    if (!tracked[videoId]) tracked[videoId] = { basis: 0, desired: null, timer: null, submitting: false };
    return tracked[videoId];
};

const applyOptimistically = (videoId, value, entry) => {
    const current = dislikesOf(videoId);
    if (typeof current !== 'number') {
        entry.basis = value;
        return;
    }

    const delta = (value === -1 ? 1 : 0) - (entry.basis === -1 ? 1 : 0);
    if (delta !== 0) remember(videoId, Math.max(0, current + delta));
    entry.basis = value;
};

// Re-reads `desired` fresh each step rather than closing over it, so a mid-flight change is picked up immediately.
const chase = (videoId, retryDelay) => {
    const entry = stateFor(videoId);
    const target = entry.desired;

    submitVote(videoId, target).then(
        () => {
            if (entry.desired !== target) return chase(videoId, RETRY_STARTING_AT);
            entry.submitting = false;
        },
        () => {
            const delay = retryDelay || RETRY_STARTING_AT;
            setTimeout(() => chase(videoId, Math.min(delay * 2, RETRY_CAPPED_AT)), delay);
        }
    );
};

const settle = (videoId) => {
    const entry = stateFor(videoId);
    entry.timer = null;
    if (entry.submitting) return; // already chasing — it re-checks `desired` on its own

    entry.submitting = true;
    chase(videoId);
};

const requestVote = (videoId, value) => {
    const entry = stateFor(videoId);
    entry.desired = value;
    applyOptimistically(videoId, value, entry);

    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => settle(videoId), SETTLE_AFTER);
};

export { requestVote };
