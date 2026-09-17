import { TIMING } from './timing.js';

export const failureOf = (status, how) => {
    if (status) return { kind: `answered ${status}`, words: `answered ${status}` };
    if (how.timedOut) return { kind: 'no answer', words: `no answer in ${TIMING.askTimeout / 1000}s` };

    return { kind: 'refused', words: `refused at once (${how.ms}ms)` };
};
