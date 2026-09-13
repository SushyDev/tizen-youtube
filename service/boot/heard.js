import { screen } from './config.js';
import { TIMING } from './timing.js';
import { held } from './state.js';
import { elapsed } from './clock.js';
import { say } from './screen.js';
import { toneOf } from './tones.js';
import { showFacts } from './facts.js';
import { probe } from './probe.js';
import { handOver } from './handover.js';
import { blocked } from './blocked.js';

const answering = () => {
    if (held.seen) return;

    held.seen = true;
    say('service', `answering after ${(elapsed() / 1000).toFixed(1)}s`, 'ok');
};

// The screen's own lines come back in the log, and are left out.
const showLog = (body) => {
    (body.log || [])
        .filter((entry) => entry.what !== screen)
        .forEach((entry) => say(entry.what, entry.text, toneOf(entry), true));

    if (typeof body.next === 'number') held.since = body.next;
};

const showWaiting = (waiting) => {
    const what = waiting ? waiting.what : 'the service';
    if (what === held.waiting) return;

    held.waiting = what;
    say('tube', `waiting: ${what}`, waiting && waiting.tone === 'bad' ? 'bad' : 'warn');
};

export const heard = (body, again) => {
    answering();
    showFacts(body.facts);
    showLog(body);

    if (body.ready) {
        if (!held.handed) probe(handOver, () => blocked(again));
        return;
    }

    showWaiting(body.waiting);
    setTimeout(again, TIMING.poll);
};
