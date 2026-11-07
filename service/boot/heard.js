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
import { sayHelp } from './help.js';
import { refresh } from './view.js';
import { sendReport } from './upload.js';
import { restartHeard } from './restart.js';
import { stopLaunching } from './launching.js';

const answering = () => {
    if (held.seen) return;

    held.seen = true;
    held.silentSince = -1;
    held.silentStuck = false;
    say('service', `answering after ${(elapsed() / 1000).toFixed(1)}s`, 'ok');
    if (!held.answeredOnce) held.answeredAt = elapsed();
    held.answeredOnce = true;
};

const settle = (again) => {
    if (held.launching) handOver();

    refresh();
    setTimeout(again, TIMING.poll);
};

const passed = (again, ms) => {
    held.through = true;
    held.throughMs = ms || 0;
    settle(again);
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

    // Something is wrong rather than slow, so the next ask has the service check everything.
    if (waiting && waiting.tone === 'bad') held.stuck = true;
    held.badWaiting = waiting && waiting.tone === 'bad' ? waiting.what : null;

    held.waiting = what;
    say('tube', `waiting: ${what}`, waiting && waiting.tone === 'bad' ? 'bad' : 'warn');
};

export const heard = (body, again) => {
    const checked = held.stuck && !held.diagnosed;

    answering();
    restartHeard();
    held.cobalt = body.cobalt || null;
    showFacts(body.facts);
    showLog(body);

    // The checks the service just ran are on screen, so this is the moment to ask for a report.
    if (checked) {
        held.diagnosed = true;

        if (body.waiting && body.waiting.tone === 'bad') {
            sendReport(refresh);
            sayHelp();
        }
    }

    if (body.ready) {
        held.badWaiting = null;
        refresh();
        if (held.through) return settle(again);
        return probe((ms) => passed(again, ms), () => blocked(again));
    }

    held.through = false;
    showWaiting(body.waiting);
    if (held.badWaiting) stopLaunching(held.badWaiting);
    refresh();
    setTimeout(again, TIMING.poll);
};
