// YouTube's own feature switches, answered by us.
//
// `_.E(name, default)` is kabuki's flag reader, and it is a plain lookup in
// `window.tectonicConfig.featureSwitches` performed at the moment the value is used. So a switch is
// not configuration that was read at startup — it is a question asked over and over, and the way to
// change one is to be there when it is asked.
//
// Hence a getter rather than a written value. A feature registers what it would like a switch to
// say and gets asked each time; answering `undefined` leaves YouTube's own value alone, so a
// setting turned off is indistinguishable from this file not existing. Writing values in instead
// meant a setting only took hold at the next launch, and then wanted a change listener, a record of
// the values to put back, and a latch saying whether it had armed — three things to be wrong about.
//
// Two facts about the object make the rest of this necessary, both read off the set:
//
//   it is not there yet   tectonicConfig is built from /tv_config, which is fetched after kabuki's
//                         own script, so nothing can be defined on it when a mod starts.
//   it is replaced        overriding a switch replaces featureSwitches wholesale rather than
//                         mutating it (`_.qg("tectonicConfig.featureSwitches", …)`), so a getter
//                         defined once ends up on an object nothing reads any more.

const answers = new Map();

// YouTube's own values, kept the first time each switch is seen and never taken again. Once rather
// than per object: the replacement copies the switches already there, which by then read as ours.
const theirs = new Map();

const switchesNow = () => {
    const config = window.tectonicConfig;
    return config && typeof config === 'object' ? config.featureSwitches : null;
};

const define = (switches, name) => {
    if (!theirs.has(name)) theirs.set(name, switches[name]);

    Object.defineProperty(switches, name, {
        configurable: true,
        enumerable: true,
        get: () => {
            const mine = answers.get(name)();
            return mine === undefined ? theirs.get(name) : mine;
        }
    });
};

const defineAll = (switches) => {
    if (!switches || typeof switches !== 'object') return;

    Array.from(answers.keys()).forEach((name) => define(switches, name));
};

// A property that reports what was last written to it and says when that happens. The value already
// there is offered too, so this works whether it arrives before or after us.
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

// Armed on the first switch anyone asks for, so a build where nothing overrides one puts no
// accessor on the property the app reads on every flag lookup. Whether it is armed is asked of the
// property itself rather than remembered in a flag: a boolean saying "already done" about something
// that can since have gone away is its own bug, and was one.
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

// `answer` is called every time YouTube asks, so it may read a setting directly: what it returns is
// what the app sees on its next lookup, with no restart and nothing to notify.
const answerSwitch = (name, answer) => {
    answers.set(name, answer);

    arm();
    defineAll(switchesNow());
};

export { answerSwitch };
