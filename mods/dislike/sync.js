// A trailing debounce that also coalesces: ramming the button stays free of proof-of-work and
// network work until presses stop, and at most one submission is ever in flight per video, chasing
// whatever value is currently wanted rather than queuing one submission per press.
import { dislikesOf, remember } from './store.js';
import { submitVote } from './vote.js';

// Long enough that a rapid run of presses never starts a submission mid-run; short enough that a
// single deliberate press still feels immediate once it lands.
const SETTLE_AFTER = 500;

const RETRY_STARTING_AT = 1000;
const RETRY_CAPPED_AT = 15000;

// Per video: `desired` is what the viewer's most recent press actually wants synced: `basis` is
// the vote value already folded into the displayed count, so repeated presses adjust it against a
// fixed point instead of compounding against whatever the display happens to read at that instant.
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

// Always re-reads `desired` at the top rather than closing over a value handed to it, so a change
// made while a submission is in flight or backing off is picked up on the very next step, not
// queued behind the one already running.
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
