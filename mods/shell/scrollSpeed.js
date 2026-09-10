import { answerSwitch, configRead } from '../../framework/index.js';

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
// The switches are answered rather than written to, which is what makes the setting take hold on
// the next press rather than the next launch — see framework/switches.js for why that distinction
// is the whole of it.

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

// Undefined for Default, which leaves YouTube's own pacing exactly as it was.
const start = () => SWITCHES.forEach((one) => answerSwitch(one.name, () => {
    const speed = chosen();
    return speed ? speed[one.rung] : undefined;
}));

export { start, SPEEDS };
