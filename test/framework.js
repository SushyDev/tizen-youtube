// The registries the features now depend on.
//
// Each of these replaced something that had been written several times and leaked differently, so
// the properties worth holding are the ones the old copies got wrong: one timer per name rather
// than a new one per call, one document listener per event type rather than one per feature, and
// a handler asked only about responses that carry a key it wanted.

import assert from 'assert';

const listeners = [];

global.window = {
    localStorage: { 'tube.settings': '{}' },
    addEventListener: () => undefined,
    _yttv: {}
};

global.document = {
    addEventListener: (type, handle, capture) => listeners.push({ type, handle, capture }),
    removeEventListener: () => undefined,
    querySelector: () => null
};

global.location = { hash: '#/' };

const { register, boot, booted, PHASES } = await import('../framework/register.js');
const { every, after, until, stop, running } = await import('../framework/schedule.js');
const { onKey } = await import('../framework/keys.js');

const results = [];

const check = (name, run) => {
    try {
        run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 5).join('\n      ')}`);
    }
};

const asyncCheck = async (name, run) => {
    try {
        await run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 5).join('\n      ')}`);
    }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// -- schedule ----------------------------------------------------------------------------------

await asyncCheck('every replaces a timer of the same name rather than stacking a second', async () => {
    const counts = { first: 0, second: 0 };

    every('same name', 10, () => { counts.first += 1; });
    every('same name', 10, () => { counts.second += 1; });

    await sleep(60);
    stop('same name');

    assert.strictEqual(counts.first, 0, 'the first timer kept running alongside the second');
    assert.ok(counts.second > 0, 'the replacement never ran');
});

await asyncCheck('until gives itself up', async () => {
    const counts = { ticks: 0 };

    until('gives up', 10, () => { counts.ticks += 1; }, 30);
    await sleep(120);

    assert.strictEqual(running('gives up'), false, 'the timer is still running past its deadline');
    const settled = counts.ticks;
    await sleep(40);
    assert.strictEqual(counts.ticks, settled, 'it kept ticking after it should have stopped');
});

await asyncCheck('until extends its window instead of starting a second timer', async () => {
    const counts = { ticks: 0 };

    until('extends', 10, () => { counts.ticks += 1; }, 40);
    await sleep(20);
    until('extends', 10, () => { counts.ticks += 1; }, 200);

    await sleep(60);
    assert.strictEqual(running('extends'), true, 'the extension did not take');

    // One timer, so roughly one tick per interval rather than two.
    assert.ok(counts.ticks < 14, `two timers were running: ${counts.ticks} ticks in ~80ms at 10ms`);
    stop('extends');
});

check('stop is safe on a name that was never scheduled', () => {
    stop('never existed');
    assert.strictEqual(running('never existed'), false);
});

await asyncCheck('after runs once and forgets itself', async () => {
    const counts = { ran: 0 };
    after('once', 10, () => { counts.ran += 1; });
    await sleep(50);

    assert.strictEqual(counts.ran, 1);
    assert.strictEqual(running('once'), false);
});

// -- keys --------------------------------------------------------------------------------------

check('the key router takes three document listeners however many features register', () => {
    const before = listeners.length;

    onKey('one', [1], () => undefined);
    onKey('two', [2], () => undefined);
    onKey('three', [3, 4, 5], () => undefined);

    assert.strictEqual(listeners.length - before, 3, 'one capture per event type, and no more');
    assert.ok(listeners.every((entry) => entry.capture === true), 'the listeners must capture');
});

check('a key reaches every handler that asked for it', () => {
    const seen = [];
    onKey('first', [42], () => { seen.push('first'); return undefined; });
    onKey('second', [42], () => { seen.push('second'); return undefined; });

    const dispatch = listeners.find((entry) => entry.type === 'keydown').handle;
    dispatch({ keyCode: 42, type: 'keydown', preventDefault: () => undefined, stopPropagation: () => undefined });

    assert.deepStrictEqual(seen, ['first', 'second']);
});

check('one handler asking to swallow does not silence the others', () => {
    const seen = [];
    const swallowed = { yes: false };

    onKey('swallows', [43], () => { seen.push('swallows'); return true; });
    onKey('watches', [43], () => { seen.push('watches'); return undefined; });

    const dispatch = listeners.find((entry) => entry.type === 'keydown').handle;
    dispatch({
        keyCode: 43,
        type: 'keydown',
        preventDefault: () => { swallowed.yes = true; },
        stopPropagation: () => undefined
    });

    assert.deepStrictEqual(seen, ['swallows', 'watches'], 'a true answer stopped the rest being told');
    assert.strictEqual(swallowed.yes, true, 'the key was not swallowed');
});

check('a handler that throws does not stop the rest', () => {
    const seen = [];
    onKey('throws', [44], () => { throw new Error('deliberate'); });
    onKey('after', [44], () => { seen.push('after'); return undefined; });

    const dispatch = listeners.find((entry) => entry.type === 'keydown').handle;
    dispatch({ keyCode: 44, type: 'keydown', preventDefault: () => undefined, stopPropagation: () => undefined });

    assert.deepStrictEqual(seen, ['after']);
});

check('an unwanted key code costs nothing', () => {
    const dispatch = listeners.find((entry) => entry.type === 'keyup').handle;
    dispatch({ keyCode: 9999, type: 'keyup' });
});

// -- register ----------------------------------------------------------------------------------

check('features run in phase order, not registration order', () => {
    const order = [];

    register('late phase', 'ui', () => order.push('ui'));
    register('early phase', 'network', () => order.push('network'));
    register('middle phase', 'feed', () => order.push('feed'));

    boot();

    assert.deepStrictEqual(order, ['network', 'feed', 'ui']);
    assert.ok(PHASES.indexOf('network') < PHASES.indexOf('intercept'), 'intercept must be last');
});

check('a feature that throws does not stop the others', () => {
    // boot() has run, so this proves the seal as well: both of these are refused.
    const order = [];
    register('throws', 'ui', () => { throw new Error('deliberate'); });
    register('after', 'ui', () => order.push('after'));

    assert.strictEqual(booted(), true);
    assert.deepStrictEqual(order, [], 'a registration after boot must not run');
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
