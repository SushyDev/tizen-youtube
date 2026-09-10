// The two settings that decide how fast the feed moves.
//
// Both reach past the response into the app, so what is checked here is the part that can be:
// scrollSpeed pins two feature switches on an object that does not exist yet and gets replaced
// once it does, and rapidPress hands a press back to YouTube's own handler rather than to one of
// its own. The shapes below are the ones read off the set — `window.tectonicConfig.featureSwitches`
// arriving late, and a component whose driver answers `isActive()`.

import assert from 'assert';

global.window = { localStorage: { 'tube.settings': '{}' }, addEventListener: () => undefined };
global.window.JSON = JSON;

const listeners = {};
global.document = {
    querySelector: () => global.document.list,
    addEventListener: (type, handle) => { listeners[type] = handle; },
    removeEventListener: () => undefined,
    list: null
};

const { configRead, configWrite } = await import('../framework/config.js');
const { SPEEDS, start: startScrollSpeed } = await import('../mods/shell/scrollSpeed.js');
const { SWITCHES, start: startSmoothNavigation } = await import('../mods/shell/smoothNavigation.js');
const { start: startRapidPress } = await import('../mods/shell/rapidPress.js');

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

const asyncCheck = async (name, run) => {
    try {
        await run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 6).join('\n      ')}`);
    }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withSetting = (key, value, run) => {
    const before = configRead(key);
    configWrite(key, value);
    try {
        return run();
    } finally {
        configWrite(key, before);
    }
};

// -- scroll speed --------------------------------------------------------------------------

// tectonicConfig is built from /tv_config, which is fetched after kabuki's own script — so it is
// absent when the mod starts, and the override has to survive its arrival.
const freshWindow = () => {
    delete global.window.tectonicConfig;
};

check('a chosen speed answers on switches that arrive after it', () => {
    freshWindow();
    withSetting('scrollSpeed', '2', () => {
        startScrollSpeed();
        global.window.tectonicConfig = {
            featureSwitches: { verticalListDurationMs: 300, horizontalListDurationMs: 200 }
        };

        const switches = global.window.tectonicConfig.featureSwitches;
        assert.strictEqual(switches.verticalListDurationMs, SPEEDS['2'].vertical);
        assert.strictEqual(switches.horizontalListDurationMs, SPEEDS['2'].horizontal);
    });
});

// The app replaces the whole object when it overrides a switch of its own, so a getter defined
// once would end up on an object nothing reads any more.
check('a chosen speed survives the switches being replaced wholesale', () => {
    freshWindow();
    withSetting('scrollSpeed', '3', () => {
        startScrollSpeed();
        global.window.tectonicConfig = {
            featureSwitches: { verticalListDurationMs: 300, horizontalListDurationMs: 200 }
        };
        global.window.tectonicConfig.featureSwitches = {
            verticalListDurationMs: 300, horizontalListDurationMs: 200, other: 1
        };

        const switches = global.window.tectonicConfig.featureSwitches;
        assert.strictEqual(switches.verticalListDurationMs, SPEEDS['3'].vertical);
        assert.strictEqual(switches.other, 1, 'the switches it did not ask about are left alone');
    });
});

check('Default answers with YouTube\u2019s own numbers', () => {
    freshWindow();
    withSetting('scrollSpeed', '', () => {
        startScrollSpeed();
        global.window.tectonicConfig = {
            featureSwitches: { verticalListDurationMs: 300, horizontalListDurationMs: 200 }
        };

        const switches = global.window.tectonicConfig.featureSwitches;
        assert.strictEqual(switches.verticalListDurationMs, 300);
        assert.strictEqual(switches.horizontalListDurationMs, 200);
    });
});

// Every rung is a real speed, solved from speed = 381 / (duration + 81). Checked rather than
// stated, because a table of numbers is exactly the thing that drifts from the comment above it.
check('every rung is the multiplier it claims, within a millisecond of rounding', () => {
    const speedOf = (duration, stock) => (stock + 81) / (duration + 81);

    Object.keys(SPEEDS).forEach((rung) => {
        const wanted = Number(rung);
        const vertical = speedOf(SPEEDS[rung].vertical, 300);
        assert.ok(Math.abs(vertical - wanted) < 0.03,
            `${rung}x vertical is ${vertical.toFixed(2)}x`);
    });
});

// Read when the value is asked for, not written once at startup: this is the whole reason the
// setting needs no restart, and writing it once is what made choosing a speed appear to do
// nothing at all.
check('changing the setting is answered on the next read, with no restart and no event', () => {
    freshWindow();
    withSetting('scrollSpeed', '', () => {
        startScrollSpeed();
        global.window.tectonicConfig = {
            featureSwitches: { verticalListDurationMs: 300, horizontalListDurationMs: 200 }
        };

        const switches = global.window.tectonicConfig.featureSwitches;
        assert.strictEqual(switches.verticalListDurationMs, 300);

        configWrite('scrollSpeed', '2');
        assert.strictEqual(switches.verticalListDurationMs, SPEEDS['2'].vertical);

        configWrite('scrollSpeed', '');
        assert.strictEqual(switches.verticalListDurationMs, 300, 'and back again');
    });
});

// -- smoother navigation -------------------------------------------------------------------

// Three of YouTube's own render-path switches, all of which arrive off. Measured on the set with
// them on, moves in the feed went from ~167ms apart to 47-92ms — near the 50ms key repeat, which is
// the ceiling. Off, they must be indistinguishable from this mod not existing.
check('the switches are answered only while the setting is on', () => {
    freshWindow();
    withSetting('enableSmoothNavigation', true, () => {
        startSmoothNavigation();
        global.window.tectonicConfig = {
            featureSwitches: {
                enableCancellableJobDeferral: false,
                enableDeferredThumbnailOnScroll: false,
                enableVirtualListItemTransition: true
            }
        };

        const switches = global.window.tectonicConfig.featureSwitches;
        Object.keys(SWITCHES).forEach((name) =>
            assert.strictEqual(switches[name], SWITCHES[name], name));

        configWrite('enableSmoothNavigation', false);
        assert.strictEqual(switches.enableCancellableJobDeferral, false, 'back to YouTube\u2019s own');
        assert.strictEqual(switches.enableVirtualListItemTransition, true);
    });
});

// Two mods now answer switches on the same object, and the second must not lose the first.
check('two features answering different switches do not displace each other', () => {
    freshWindow();
    withSetting('scrollSpeed', '2', () => {
        withSetting('enableSmoothNavigation', true, () => {
            startScrollSpeed();
            startSmoothNavigation();
            global.window.tectonicConfig = {
                featureSwitches: {
                    verticalListDurationMs: 300,
                    enableVirtualListItemTransition: true
                }
            };

            const switches = global.window.tectonicConfig.featureSwitches;
            assert.strictEqual(switches.verticalListDurationMs, SPEEDS['2'].vertical);
            assert.strictEqual(switches.enableVirtualListItemTransition, false);
        });
    });
});

// -- rapid press ---------------------------------------------------------------------------

const componentOf = (moving) => {
    const seen = [];
    const prototype = {
        onKeyDown(event) { seen.push(event.keyCode); }
    };
    const component = Object.create(prototype);

    component.j = { isActive: () => moving.now };
    component.seen = seen;
    return component;
};

// The whole rule, stated as arithmetic: what goes in comes out, once each. Two deliverers is what
// got this wrong twice, so what is checked is the total rather than the mechanism.
//
// Presses are spaced the way a person presses. Timing is how a held key is told from a pressed one
// — a synthesised event carries no `repeat`, and kabuki re-dispatches key events in exactly the
// lists where this went wrong — so a burst fired in the same millisecond is not a fast viewer, it
// is a key being held, and is read as one.
const PRESS = { keyCode: 40, repeat: false, preventDefault() {}, stopPropagation() {} };

const pressing = async (component, times, apart) => {
    const one = async (n) => {
        if (n >= times) return;
        component.onKeyDown(Object.assign({}, PRESS));
        await sleep(apart);
        await one(n + 1);
    };

    await one(0);
};

await asyncCheck('four presses during a move are four moves, not three and not six', async () => {
    const moving = { now: false };
    const component = componentOf(moving);
    global.document.list = { __instance: component };

    await withSetting('enableRapidPress', true, async () => {
        startRapidPress();
        await sleep(400);

        // The first lands while the list is still, and moves it.
        component.onKeyDown(Object.assign({}, PRESS));
        assert.strictEqual(component.seen.length, 1);

        // Three more while it is moving. YouTube's handler must not see them yet.
        moving.now = true;
        await sleep(120);
        await pressing(component, 3, 120);
        assert.strictEqual(component.seen.length, 1, 'nothing reached the list while it was moving');

        moving.now = false;
        await sleep(400);
        assert.strictEqual(component.seen.length, 4, 'and all three arrive once it is free');
    });
});

// The bug this was reported as: letting go of a held key and watching the list carry on without
// you. Every repeat had been held, because a re-dispatched event says it is not one.
await asyncCheck('a key held at the repeat rate is never held back, whatever the event claims', async () => {
    const moving = { now: true };
    const component = componentOf(moving);
    global.document.list = { __instance: component };

    await withSetting('enableRapidPress', true, async () => {
        startRapidPress();
        await sleep(400);

        // Twelve repeats at 50ms, none of them admitting to being a repeat.
        await pressing(component, 12, 50);
        const during = component.seen.length;

        moving.now = false;
        await sleep(300);

        assert.strictEqual(component.seen.length, during,
            'letting go must not scroll on: nothing was waiting');
    });
});

await asyncCheck('a press made while the feed is still goes straight through', async () => {
    const moving = { now: false };
    const component = componentOf(moving);
    global.document.list = { __instance: component };

    await withSetting('enableRapidPress', true, async () => {
        startRapidPress();
        await sleep(400);
        await pressing(component, 3, 120);
        await sleep(200);

        assert.strictEqual(component.seen.length, 3, 'three presses, three moves, no waiting');
    });
});

await asyncCheck('with the setting off nothing is held at all', async () => {
    const moving = { now: true };
    const component = componentOf(moving);
    global.document.list = { __instance: component };

    await withSetting('enableRapidPress', false, async () => {
        startRapidPress();
        await sleep(400);

        component.onKeyDown(Object.assign({}, PRESS));
        moving.now = false;
        await sleep(200);

        assert.strictEqual(component.seen.length, 1, 'YouTube coalesces it, as it does by default');
    });
});

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
