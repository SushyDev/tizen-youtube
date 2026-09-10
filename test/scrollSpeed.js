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
const burst = async (presses, component, moving) => {
    startRapidPress();
    await sleep(400);

    const press = (n) => {
        if (n >= presses) return;
        component.onKeyDown({ keyCode: 40, repeat: false, preventDefault() {}, stopPropagation() {} });
        press(n + 1);
    };

    press(0);
    moving.now = false;
    await sleep(600);
};

await asyncCheck('five presses during a move are five moves, not four and not seven', async () => {
    const moving = { now: false };
    const component = componentOf(moving);
    global.document.list = { __instance: component };

    await withSetting('enableRapidPress', true, async () => {
        startRapidPress();
        await sleep(400);

        // The first lands while the list is still, and moves it.
        component.onKeyDown({ keyCode: 40, repeat: false, preventDefault() {}, stopPropagation() {} });
        assert.strictEqual(component.seen.length, 1);

        // The next four arrive while it is moving. YouTube's handler must not see them yet.
        moving.now = true;
        const held = (n) => {
            if (n >= 4) return;
            component.onKeyDown({
                keyCode: 40, repeat: false, preventDefault() {}, stopPropagation() {}
            });
            held(n + 1);
        };
        held(0);
        assert.strictEqual(component.seen.length, 1, 'nothing reached the list while it was moving');

        moving.now = false;
        await sleep(400);
        assert.strictEqual(component.seen.length, 5, 'and all four arrive once it is free');
    });
});

// A press the list can act on straight away must not go near any of this.
await asyncCheck('a press made while the feed is still goes straight through', async () => {
    const moving = { now: false };
    const component = componentOf(moving);
    global.document.list = { __instance: component };

    await withSetting('enableRapidPress', true, async () => {
        await burst(3, component, moving);
        assert.strictEqual(component.seen.length, 3, 'three presses, three moves, no waiting');
    });
});

await asyncCheck('a held key is never held back', async () => {
    const moving = { now: true };
    const component = componentOf(moving);
    global.document.list = { __instance: component };

    await withSetting('enableRapidPress', true, async () => {
        startRapidPress();
        await sleep(400);

        component.onKeyDown({ keyCode: 40, repeat: true, preventDefault() {}, stopPropagation() {} });
        component.onKeyDown({ keyCode: 40, repeat: true, preventDefault() {}, stopPropagation() {} });

        assert.strictEqual(component.seen.length, 2, 'repeats reach the list as they always did');

        moving.now = false;
        await sleep(200);
        assert.strictEqual(component.seen.length, 2, 'and none of them come back a second time');
    });
});

await asyncCheck('with the setting off nothing is held at all', async () => {
    const moving = { now: true };
    const component = componentOf(moving);
    global.document.list = { __instance: component };

    await withSetting('enableRapidPress', false, async () => {
        startRapidPress();
        await sleep(400);

        component.onKeyDown({ keyCode: 40, repeat: false, preventDefault() {}, stopPropagation() {} });
        moving.now = false;
        await sleep(200);

        assert.strictEqual(component.seen.length, 1, 'YouTube coalesces it, as it does by default');
    });
});

// It arms whether or not the setting is on, so turning it on works there and then.
await asyncCheck('turning it on after startup takes hold without a restart', async () => {
    const moving = { now: true };
    const component = componentOf(moving);
    global.document.list = { __instance: component };

    const before = configRead('enableRapidPress');
    configWrite('enableRapidPress', false);

    try {
        startRapidPress();
        await sleep(400);

        configWrite('enableRapidPress', true);
        component.onKeyDown({
            keyCode: 40, repeat: false, preventDefault() {}, stopPropagation() {}
        });
        assert.strictEqual(component.seen.length, 0, 'held rather than coalesced');

        moving.now = false;
        await sleep(200);
        assert.strictEqual(component.seen.length, 1);
    } finally {
        configWrite('enableRapidPress', before);
    }
});

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
