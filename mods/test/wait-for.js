import { waitFor } from '../utils/waitFor.js';

const results = [];

const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
};

const seen = { now: null, late: null, never: 0, looks: 0, stoppedLooks: 0, throwingLooks: 0, throwingFound: 0 };

waitFor(() => 'here', (found) => { seen.now = found; });
check('a value already there is delivered at once', seen.now === 'here', String(seen.now));

const appearsAt = Date.now() + 250;
waitFor(() => (Date.now() > appearsAt ? 'late' : null), (found) => { seen.late = found; }, { everyMs: 40 });

waitFor(
    () => { seen.looks += 1; return null; },
    () => { seen.never += 1; },
    { everyMs: 20, forMs: 120 }
);

const stop = waitFor(() => { seen.stoppedLooks += 1; return null; }, () => {}, { everyMs: 20, forMs: 5000 });
stop();

const threw = (() => {
    try {
        waitFor(
            () => { seen.throwingLooks += 1; throw new Error('mid-render'); },
            () => { seen.throwingFound += 1; },
            { everyMs: 20, forMs: 40 }
        );
        return false;
    } catch (e) {
        return true;
    }
})();

setTimeout(() => {
    check('a value that appears later is delivered', seen.late === 'late', String(seen.late));
    check('a finder that never succeeds gives up',
        seen.never === 0 && seen.looks > 1 && seen.looks < 12,
        `called back ${seen.never} times after ${seen.looks} looks`);
    check('stop() prevents any further look', seen.stoppedLooks === 1, String(seen.stoppedLooks));
    check('a finder that throws is treated as not found',
        !threw && seen.throwingLooks > 1 && seen.throwingFound === 0,
        `threw ${threw}, called back ${seen.throwingFound} times after ${seen.throwingLooks} looks`);

    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
}, 700);
