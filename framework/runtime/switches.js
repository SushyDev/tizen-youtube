import { report } from '../registries/journal.js';

const held = {
    answers: new Map(),

    // YouTube's own values, re-read only while nothing is answered: a replacement object copies
    // our answers rather than YouTube's values.
    theirs: new Map()
};

const switchesNow = () => {
    const config = window.tectonicConfig;
    return config && typeof config === 'object' ? config.featureSwitches : null;
};

// The answer runs on YouTube's stack, so an unguarded throw here is a page bug rather than a
// feature that went quiet.
const answerOf = (name) => {
    try {
        return held.answers.get(name)();
    } catch (failure) {
        report(`switch:${name}`, 'failed', failure);
        return undefined;
    }
};

const define = (switches, name) => {
    if (!held.theirs.has(name) || answerOf(name) === undefined) {
        held.theirs.set(name, switches[name]);
    }

    Object.defineProperty(switches, name, {
        configurable: true,
        enumerable: true,
        get: () => {
            const mine = answerOf(name);
            return mine === undefined ? held.theirs.get(name) : mine;
        }
    });
};

const defineAll = (switches) => {
    if (!switches || typeof switches !== 'object') return;

    Array.from(held.answers.keys()).forEach((name) => define(switches, name));
};

// Also offers the value already there, so a config that arrived before us is still seen.
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

// Armed on first use, so a build that answers nothing leaves tectonicConfig untouched.
const armed = () => {
    const described = Object.getOwnPropertyDescriptor(window, 'tectonicConfig');
    return !!(described && described.get);
};

const arm = () => {
    if (armed()) return;

    watch(window, 'tectonicConfig', (config) => {
        if (!config || typeof config !== 'object') return;

        watch(config, 'featureSwitches', defineAll);
    });
};

// `answer` runs on every lookup, so it may read a setting directly and takes effect with no restart.
const answerSwitch = (name, answer) => {
    held.answers.set(name, answer);

    arm();
    defineAll(switchesNow());
};

export { answerSwitch };
