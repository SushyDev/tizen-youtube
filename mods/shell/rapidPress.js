import { configRead, every, stop, whenFound } from '../../framework/index.js';

// Pressing a direction faster than the feed can move it.
//
// Unrelated to how fast a held key scrolls, which is scrollSpeed.js. This is about the presses
// that are thrown away.
//
// While a move is in flight the virtual list stashes the index it was asked for instead of
// applying it, and there is exactly one slot: press five times during one move and all five write
// to that slot, so four are lost. That is the throttle.
//
// The rule this holds to is that one press is one move, and never more. Getting there took two
// wrong turns worth writing down, because both look right:
//
//   replaying every held press   double-counted, because the slot is not stale — the committed
//                                index advances the moment a move starts and only the animation
//                                lags, so YouTube's stash lands a real move of its own.
//   replaying all but the first  raced. Whether the slot or the replay arrived first decided
//                                whether the total was right, so it was sometimes right.
//
// Both failed for the same reason: two things were delivering presses. So while a list is moving
// its handler is not called at all — nothing reaches the slot, and there is one deliverer, which
// is this. Each held press is handed to YouTube's own handler once the list is free, one per move,
// and it computes the next index from a committed one that has moved on by then.
//
// Held presses are swallowed rather than passed on, because the handler that would have consumed
// them is the one not being called. The case that would notice is a list at its own edge, where
// the handler deliberately leaves the event alone so focus can move out — and read off the set, a
// shelf does not have one: holding right runs off the end and wraps to the start, so the index it
// is asked for is never the index it is on, and that path is never taken. A list that did stop at
// its edge would be still rather than moving, so its presses would take the plain path above
// anyway.
//
// Only presses, never a held key: a held key repeats every 50ms on this television (measured), and
// replaying those would keep the feed moving long after the viewer let go. KeyboardEvent.repeat
// tells the two apart and the set reports it correctly — 101 presses against 354 repeats in one
// recording — which is exactly the line this setting is drawn along.

const DIRECTIONS = [37, 38, 39, 40, 176, 177];

// A burst nobody meant, capped. Ten presses ahead is already more than a viewer can be waiting on.
const MOST_HELD = 10;

// About a frame. It only runs while a press is waiting, and it is the only delay this adds — the
// rest of what a burst costs is the moves themselves, which is what Scroll speed is for.
const DRAIN_EVERY = 16;

// Per component, because two lists move independently — a shelf inside a feed is its own list with
// its own stash. Weak, so a list the page has dropped is not held here by its own accounting.
const state = new WeakMap();

const held = { pumping: false, tracked: [] };

const stateOf = (component) => {
    const found = state.get(component);
    if (found) return found;

    const fresh = { waiting: [] };
    state.set(component, fresh);
    held.tracked = held.tracked.filter((one) => one !== component).concat([component]);
    return fresh;
};

const wanted = () => configRead('enableRapidPress');

// The list's own answer to "am I still moving?". Both names survive minification because the
// driver is an interface; the fields around them do not, and this reads none of them.
const isMoving = (component) => {
    const driver = component && component.j;
    return !!driver && typeof driver.isActive === 'function' && driver.isActive();
};

// One per move: the handler moves the list, which makes it busy again, so the next tick to find it
// free is the next move's turn. That is what keeps the count exact.
const settle = (component) => {
    const one = stateOf(component);
    const next = one.waiting.shift();
    if (!next) return;

    try {
        next.handle.call(component, next.event);
    } catch (failure) {
        console.warn('[rapid press] could not deliver a held press.', failure);
    }
};

const waiting = () => held.tracked.some((component) => {
    const one = state.get(component);
    return !!one && one.waiting.length > 0;
});

const pump = () => {
    if (held.pumping) return;

    held.pumping = true;
    every('rapid press', DRAIN_EVERY, () => {
        held.tracked.filter((component) => !isMoving(component)).forEach(settle);

        if (waiting()) return undefined;

        held.pumping = false;
        return stop('rapid press');
    });
};

const isDirection = (event) => !!event
    && !event.repeat
    && DIRECTIONS.indexOf(event.keyCode) !== -1;

// What the handler being skipped would have done with it.
const consume = (event) => {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
};

// Wrapped, not replaced: a press that arrives while the list is still is handed straight to
// YouTube's handler and nothing here touches it. Only the ones that would have been thrown away
// take the other path.
const patch = (prototype) => {
    const handle = prototype.onKeyDown;
    if (typeof handle !== 'function' || handle.tubeRapidPress) return;

    const wrapped = function onKeyDown(event) {
        if (!wanted() || !isDirection(event) || !isMoving(this)) return handle.call(this, event);

        const one = stateOf(this);
        if (one.waiting.length < MOST_HELD) one.waiting.push({ handle, event });

        consume(event);
        pump();
        return undefined;
    };

    wrapped.tubeRapidPress = true;
    prototype.onKeyDown = wrapped;
};

// The class is not in the module registry under any name we could ask for, but an instance of it
// is on every list the page draws, and the element hands its component over.
const listPrototype = () => {
    const list = document.querySelector('yt-virtual-list');
    const component = list && list.__instance;
    return component ? Object.getPrototypeOf(component) : null;
};

// Armed whether or not the setting is on, because the wrapper asks on every press: turning it on
// takes hold immediately rather than at the next launch. Reading it here instead is what made the
// scroll-speed setting appear dead until the app was reopened.
const start = () => {
    whenFound('rapid press', listPrototype, (prototype) => {
        if (typeof prototype.onKeyDown === 'function') return patch(prototype);

        return console.warn('[rapid press] the feed list does not answer to onKeyDown on this'
            + ' build; presses will be dropped as they always were.');
    }, { every: 250 });
};

export { start };
