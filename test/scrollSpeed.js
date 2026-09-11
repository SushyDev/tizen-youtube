import assert from 'assert';

global.window = { localStorage: { 'tube.settings': '{}' }, addEventListener: () => undefined };
global.window.JSON = JSON;

global.document = {
    querySelector: () => global.document.list,
    addEventListener: () => undefined,
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

const withSettingAsync = async (key, value, run) => {
    const before = configRead(key);
    configWrite(key, value);
    try {
        return await run();
    } finally {
        configWrite(key, before);
    }
};

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
            featureSwitches: { verticalListDurationMs: 320, horizontalListDurationMs: 210 }
        };

        const switches = global.window.tectonicConfig.featureSwitches;
        assert.strictEqual(switches.verticalListDurationMs, 320);
        assert.strictEqual(switches.horizontalListDurationMs, 210);
    });
});

check('every rung matches its multiplier on both axes', () => {
    const stock = { vertical: 300, horizontal: 200 };
    const durationOf = (speed, from) => (from + 81) / speed - 81;

    Object.keys(SPEEDS).forEach((rung) => Object.keys(stock).forEach((axis) => {
        const exact = durationOf(Number(rung), stock[axis]);
        assert.ok(Math.abs(SPEEDS[rung][axis] - exact) <= 0.5,
            `${rung}x ${axis} is ${SPEEDS[rung][axis]}ms rather than ${exact.toFixed(1)}ms`);
    }));
});

check('a changed setting is answered on the next read', () => {
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

const listClass = () => ({
    onKeyDown(event) {
        if (this.takes.indexOf(event.keyCode) === -1) return;

        if (this.j.isActive()) this.overlapped += 1;
        this.seen.push(event.keyCode);
        this.until = Date.now() + this.moveFor;
        event.stopPropagation();
    }
});

const listOf = (prototype, moving, options) => {
    const component = Object.create(prototype);
    const shape = Object.assign({ takes: [37, 38, 39, 40], moveFor: 0 }, options);

    component.j = { isActive: () => moving.now || Date.now() < component.until };
    component.seen = [];
    component.overlapped = 0;
    component.until = 0;
    component.takes = shape.takes;
    component.moveFor = shape.moveFor;
    return component;
};

const componentOf = (moving, options) => listOf(listClass(), moving, options);

const bubbleThrough = (event, lists) => lists.find((list) => {
    list.onKeyDown(event);
    return !!event.stopped;
});

const PRESS = {
    keyCode: 40, repeat: false, preventDefault() {}, stopPropagation() { this.stopped = true; }
};

const pressing = async (component, times, apart) => {
    const one = async (n) => {
        if (n >= times) return;
        component.onKeyDown(Object.assign({}, PRESS));
        await sleep(apart);
        await one(n + 1);
    };

    await one(0);
};

await asyncCheck('three presses during a move land as three moves', async () => {
    const moving = { now: false };
    const component = componentOf(moving, { moveFor: 60 });
    global.document.list = { __instance: component };

    await withSettingAsync('enableRapidPress', true, async () => {
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
        await sleep(500);
        assert.strictEqual(component.seen.length, 4, 'and all three arrive once it is free');
        assert.strictEqual(component.overlapped, 0, 'one per move, never during one');
    });
});

await asyncCheck('a released hold leaves nothing waiting', async () => {
    const moving = { now: false };
    const component = componentOf(moving);
    global.document.list = { __instance: component };

    await withSettingAsync('enableRapidPress', true, async () => {
        startRapidPress();
        await sleep(400);

        component.onKeyDown(Object.assign({}, PRESS));
        moving.now = true;
        await sleep(120);

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

    await withSettingAsync('enableRapidPress', true, async () => {
        startRapidPress();
        await sleep(400);
        await pressing(component, 3, 120);
        await sleep(200);

        assert.strictEqual(component.seen.length, 3, 'three presses, three moves, no waiting');
    });
});

await asyncCheck('a press delivered twice is held once', async () => {
    const moving = { now: false };
    const component = componentOf(moving);
    global.document.list = { __instance: component };

    await withSettingAsync('enableRapidPress', true, async () => {
        startRapidPress();
        component.onKeyDown(Object.assign({}, PRESS));
        moving.now = true;
        await sleep(120);

        component.onKeyDown(Object.assign({}, PRESS));
        component.onKeyDown(Object.assign({}, PRESS));
        assert.strictEqual(component.seen.length, 1, 'neither copy reached the list while it was moving');

        moving.now = false;
        await sleep(200);
        assert.strictEqual(component.seen.length, 2, 'and the press lands once');
    });
});

await asyncCheck('a press through a still shelf is held by the moving feed around it', async () => {
    const prototype = listClass();
    const feedMoving = { now: false };
    const feed = listOf(prototype, feedMoving, { takes: [38, 40] });
    const shelf = listOf(prototype, { now: false }, { takes: [37, 39] });
    global.document.list = { __instance: feed };

    await withSettingAsync('enableRapidPress', true, async () => {
        startRapidPress();
        bubbleThrough(Object.assign({}, PRESS), [shelf, feed]);
        feedMoving.now = true;
        await sleep(120);

        bubbleThrough(Object.assign({}, PRESS), [shelf, feed]);
        assert.strictEqual(feed.seen.length, 1, 'held while the feed was moving');

        feedMoving.now = false;
        await sleep(200);
        assert.strictEqual(feed.seen.length, 2, 'and delivered to the feed once it was free');
    });
});

await asyncCheck('a press across a moving shelf reaches the feed around it', async () => {
    const prototype = listClass();
    const shelfMoving = { now: false };
    const feed = listOf(prototype, { now: false }, { takes: [38, 40] });
    const shelf = listOf(prototype, shelfMoving, { takes: [37, 39] });
    global.document.list = { __instance: feed };

    await withSettingAsync('enableRapidPress', true, async () => {
        startRapidPress();
        bubbleThrough(Object.assign({}, PRESS, { keyCode: 39 }), [shelf, feed]);
        shelfMoving.now = true;
        await sleep(120);

        bubbleThrough(Object.assign({}, PRESS), [shelf, feed]);
        assert.strictEqual(feed.seen.length, 1, 'the feed moved at once');
        assert.strictEqual(shelf.seen.length, 1, 'and the shelf kept only its own press');
    });
});

await asyncCheck('with the setting off nothing is held at all', async () => {
    const moving = { now: false };
    const component = componentOf(moving);
    global.document.list = { __instance: component };

    await withSettingAsync('enableRapidPress', false, async () => {
        startRapidPress();
        await sleep(400);

        component.onKeyDown(Object.assign({}, PRESS));
        moving.now = true;
        await sleep(120);

        component.onKeyDown(Object.assign({}, PRESS));
        assert.strictEqual(component.seen.length, 2, 'YouTube coalesces it, as it does by default');
    });
});

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
