import { configRead } from '../../framework/index.js';

// How fast the feed moves when a direction is held.
//
// The limiter is YouTube's own, and it is a number rather than a throttle. The list container's
// style is built as `transition: transform <duration>ms <curve>`, and the list refuses the next
// move until that transition ends — so the animation *is* the pacing. Both durations come from
// feature switches read through `_.E(name, default)`, which is a plain lookup in
// `window.tectonicConfig.featureSwitches`. Setting them is what the switch is for, so this is the
// whole of the override: no patched method, no `!important`, nothing that reads a minified name.
//
// Measured on the set at 300ms: keys repeat at 50ms, a move lands every ~381ms. So the television
// is nowhere near the limit — one move in eight key repeats is all that gets through.
//
// The durations are speed multipliers rather than duration ones, which are not the same thing: a
// move costs its animation plus ~81ms of fixed work, so 90ms is 2.2x rather than the 3.3x a
// duration scale would claim. They were solved from `speed = 381 / (duration + 81)`.
//
// One caveat the table cannot express: that 81ms is not a constant, it is what one move costs to
// render, and a dense page costs more. Measured on the home feed the floor is around 165ms, so the
// last two rungs are worth less there than on a lighter page. They are ceilings, not promises.
//
// The switches are answered by a getter rather than written to, and that is the point: `_.E` asks
// for the value when it builds the style for a move, so what it gets is whatever the setting says
// at that moment. Writing a number in once meant the setting only took hold at the next launch —
// and then needed a change listener, a record of the values to put back, and a latch saying
// whether it had armed, each of which was its own way to be wrong. A getter needs none of them.

const SPEEDS = {
    '1.25': { vertical: 224, horizontal: 144 },
    '1.5': { vertical: 173, horizontal: 106 },
    '2': { vertical: 110, horizontal: 60 },
    '2.5': { vertical: 71, horizontal: 31 },
    '3': { vertical: 46, horizontal: 20 }
};

const SWITCHES = [
    { name: 'verticalListDurationMs', rung: 'vertical' },
    { name: 'horizontalListDurationMs', rung: 'horizontal' }
];

const chosen = () => SPEEDS[configRead('scrollSpeed')] || null;

// YouTube's own numbers, kept the first time they are seen and never taken again. Once from the
// first object rather than per object: when the app overrides a switch of its own it copies the
// ones already there, which by then would be reading back as ours.
const held = { theirs: null };

const remember = (switches) => {
    if (held.theirs) return;

    held.theirs = SWITCHES.reduce((all, one) =>
        Object.assign(all, { [one.rung]: switches[one.name] }), {});
};

const answer = (switches) => {
    if (!switches || typeof switches !== 'object') return;

    remember(switches);

    SWITCHES.forEach((one) => Object.defineProperty(switches, one.name, {
        configurable: true,
        enumerable: true,
        get: () => {
            const speed = chosen();
            return speed ? speed[one.rung] : held.theirs[one.rung];
        }
    }));
};

// A property that reports what was last written to it and says when that happens. The value
// already there is offered too, so this works whether it arrives before or after us.
const watch = (owner, name, onSet) => {
    const kept = { value: owner[name] };

    Object.defineProperty(owner, name, {
        configurable: true,
        enumerable: true,
        get: () => kept.value,
        set: (value) => { kept.value = value; onSet(value); }
    });

    if (kept.value !== undefined) onSet(kept.value);
};

// Both halves are watched, and both have to be. tectonicConfig does not exist yet when this runs —
// it is built from /tv_config, which is fetched after kabuki's own script — and featureSwitches is
// replaced wholesale rather than mutated when the app overrides a switch of its own
// (`_.qg("tectonicConfig.featureSwitches", …)`), so a getter defined once would end up on an
// object nothing reads any more.
const start = () => {
    watch(window, 'tectonicConfig', (config) => {
        if (!config || typeof config !== 'object') return;

        watch(config, 'featureSwitches', answer);
    });
};

export { start, SPEEDS };
