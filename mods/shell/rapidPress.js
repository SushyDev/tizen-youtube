import {
    configRead, every, isListMoving, stop, virtualListPrototype, whenFound
} from '../../framework/index.js';

// Holds direction presses made while a list is still moving and hands them to YouTube's own
// handler one move at a time.

const ARROWS = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40 };

const AXES = {
    horizontal: [ARROWS.LEFT, ARROWS.RIGHT],
    vertical: [ARROWS.UP, ARROWS.DOWN]
};

// Between the 50ms a held key repeats at and the ~125ms of someone pressing as fast as they can,
// with room on both sides.
const REPEAT_WINDOW = 90;

const REDISPATCH_WINDOW = 10;

const MOST_HELD = 10;

// About one frame.
const DRAIN_EVERY = 16;

const held = {
    pumping: false,
    queued: [],
    lastSeen: new Map(),
    judged: new WeakMap(),

    // Per component, because two lists move independently — a shelf inside a feed is its own list
    // with its own stash.
    lists: new WeakMap()
};

const stateOf = (component) => {
    const found = held.lists.get(component);
    if (found) return found;

    const fresh = { waiting: [], axis: null };
    held.lists.set(component, fresh);
    return fresh;
};

const wanted = () => configRead('enableRapidPress');

const axisOf = (keyCode) => Object.keys(AXES).find((axis) => AXES[axis].indexOf(keyCode) !== -1);

const movesAlong = (component, axis) => {
    const one = held.lists.get(component);
    return !!one && one.axis === axis;
};

// A repeat of the same key cancels its queued first press, so releasing a hold adds no move.
const forget = (component, keyCode) => {
    const one = held.lists.get(component);
    if (one) one.waiting = one.waiting.filter((press) => press.keyCode !== keyCode);
};

const isHeldCopy = (component, keyCode, at) => {
    const one = held.lists.get(component);
    return !!one && one.waiting.some((press) =>
        press.keyCode === keyCode && at - press.at < REDISPATCH_WINDOW);
};

// One press per tick at most, because delivering it makes the list busy again.
const settle = (component) => {
    const one = stateOf(component);
    const next = one.waiting[0];
    if (!next) return;

    one.waiting = one.waiting.slice(1);
    try {
        next.handle.call(component, next.event);
    } catch (failure) {
        console.warn('[rapid press] could not deliver a held press.', failure);
    }
};

const pump = () => {
    if (held.pumping) return;

    held.pumping = true;
    every('rapid press', DRAIN_EVERY, () => {
        held.queued.filter((component) => !isListMoving(component)).forEach(settle);
        held.queued = held.queued.filter((component) => stateOf(component).waiting.length > 0);
        if (held.queued.length) return;

        held.pumping = false;
        stop('rapid press');
    });
};

const isDirection = (event) => !!event && axisOf(event.keyCode) !== undefined;

// Every direction event is judged, since one skipped would leave the next repeat looking like a
// fresh press.
const judge = (event) => {
    const known = held.judged.get(event);
    if (known) return known;

    const at = Date.now();
    const before = held.lastSeen.get(event.keyCode);
    held.lastSeen.set(event.keyCode, at);

    const fresh = !event.repeat && (before === undefined || at - before > REPEAT_WINDOW);
    const press = { at, fresh };
    held.judged.set(event, press);
    return press;
};

// What the handler being skipped would have done with it.
const consume = (event) => {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
};

const hold = (component, handle, event, at) => {
    const one = stateOf(component);
    if (one.waiting.length < MOST_HELD) {
        one.waiting = one.waiting.concat([{ handle, event, keyCode: event.keyCode, at }]);
    }
    if (held.queued.indexOf(component) === -1) held.queued = held.queued.concat([component]);

    consume(event);
    pump();
};

const patch = (prototype) => {
    const handle = prototype.onKeyDown;
    if (typeof handle !== 'function') {
        console.warn('[rapid press] the feed list does not answer to onKeyDown on this'
            + ' build; presses will be dropped as they always were.');
        return;
    }
    if (handle.tubeRapidPress) return;

    const wrapped = function onKeyDown(event) {
        if (!wanted() || !isDirection(event)) return handle.call(this, event);

        const press = judge(event);
        const axis = axisOf(event.keyCode);

        if (!press.fresh && isHeldCopy(this, event.keyCode, press.at)) {
            consume(event);
            return undefined;
        }

        if (!press.fresh) forget(this, event.keyCode);

        if (!isListMoving(this)) {
            stateOf(this).axis = axis;
            return handle.call(this, event);
        }

        if (!press.fresh || !movesAlong(this, axis)) return handle.call(this, event);

        hold(this, handle, event, press.at);
        return undefined;
    };

    wrapped.tubeRapidPress = true;
    prototype.onKeyDown = wrapped;
};

// Patched regardless of the setting, because the wrapper reads it on every press.
const start = () => {
    whenFound('rapid press', virtualListPrototype, patch, { forMs: Infinity });
};

export { start };
