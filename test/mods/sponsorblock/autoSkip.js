import assert from 'assert';

global.window = { localStorage: { 'tube.settings': '{}' }, addEventListener: () => undefined };
global.window.JSON = JSON;

const { autoSkipper } = await import('../../../mods/sponsorblock/autoSkip.js');

const results = [];

const check = (name, run) => {
    try {
        run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 6).join('\n      ')}`);
    }
};

// schedule() only ever holds one outstanding timeout, so a single slot is enough to fake it.
const fakeTimers = () => {
    const held = { pending: null, nextId: 1 };

    global.setTimeout = (fn, delay) => {
        held.pending = { id: held.nextId, fn, delay };
        return held.nextId++;
    };

    global.clearTimeout = (id) => {
        if (held.pending && held.pending.id === id) held.pending = null;
    };

    return {
        delay: () => (held.pending ? held.pending.delay : null),
        fire: () => {
            if (!held.pending) return;
            const { fn } = held.pending;
            held.pending = null;
            fn();
        }
    };
};

const seg = (category, from, to) => ({ category, segment: [from, to], UUID: `${category}-${from}-${to}` });

const video = (overrides) => Object.assign({ currentTime: 0, duration: 100, paused: false, playbackRate: 1 }, overrides);

check('the wait for a skip scales with playback speed', () => {
    const timers = fakeTimers();
    const v = video({ playbackRate: 2 });

    const skipper = autoSkipper([seg('sponsor', 10, 20)], ['sponsor'], []);
    skipper.watch(v);
    skipper.schedule();

    // At 2x, the video covers the 10s to the segment's start in half the real time.
    assert.strictEqual(timers.delay(), 5000, `expected 5000ms at 2x speed, got ${timers.delay()}`);
});

check('a playback rate of zero does not divide the wait by zero', () => {
    const timers = fakeTimers();
    const v = video({ playbackRate: 0 });

    const skipper = autoSkipper([seg('sponsor', 10, 20)], ['sponsor'], []);
    skipper.watch(v);
    skipper.schedule();

    assert.strictEqual(timers.delay(), 10000, `expected the 1x wait as a fallback, got ${timers.delay()}`);
});

check('a skip lands past a second segment that overlaps the one just skipped', () => {
    const timers = fakeTimers();
    const v = video();

    // sponsor runs 10-20, but an interaction reminder overlaps it and runs on to 30.
    const skipper = autoSkipper(
        [seg('sponsor', 10, 20), seg('interaction', 15, 30)],
        ['sponsor', 'interaction'], []
    );
    skipper.watch(v);
    skipper.schedule();
    timers.fire();

    assert.strictEqual(v.currentTime, 30, `expected the jump to reach past both segments, got ${v.currentTime}`);
});

check('a chain of three overlapping segments is followed to the furthest end', () => {
    const timers = fakeTimers();
    const v = video();

    // None of these three overlap the first (10-20) directly except the middle one, which
    // chains through to the third.
    const skipper = autoSkipper(
        [seg('sponsor', 10, 20), seg('selfpromo', 18, 25), seg('preview', 24, 40)],
        ['sponsor', 'selfpromo', 'preview'], []
    );
    skipper.watch(v);
    skipper.schedule();
    timers.fire();

    assert.strictEqual(v.currentTime, 40, `expected the chain to reach the last segment's end, got ${v.currentTime}`);
});

check('a segment that does not actually overlap does not extend the jump', () => {
    const timers = fakeTimers();
    const v = video();

    // outro starts exactly where sponsor ends, so it is adjacent, not overlapping.
    const skipper = autoSkipper(
        [seg('sponsor', 10, 20), seg('outro', 20, 30)],
        ['sponsor', 'outro'], []
    );
    skipper.watch(v);
    skipper.schedule();
    timers.fire();

    assert.strictEqual(v.currentTime, 20, `expected the plain segment end, got ${v.currentTime}`);
});

check('a manual-only segment does not extend an auto-skip past it', () => {
    const timers = fakeTimers();
    const v = video();

    // interaction overlaps sponsor but is set to ask-first, so it must not stretch the jump.
    const skipper = autoSkipper(
        [seg('sponsor', 10, 20), seg('interaction', 15, 30)],
        ['sponsor', 'interaction'], ['interaction']
    );
    skipper.watch(v);
    skipper.schedule();
    timers.fire();

    assert.strictEqual(v.currentTime, 20, `expected the jump to stop at sponsor's own end, got ${v.currentTime}`);
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
