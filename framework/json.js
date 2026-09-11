import { until } from './schedule.js';
import { booted } from './register.js';

// Handlers are indexed by key so a response reaches only the handlers that asked for one of its keys.
const readers = Object.create(null);
const writers = Object.create(null);

const order = { next: 0 };

const file = (index, name, keys, handle) => {
    const entry = { id: order.next, name, handle };
    order.next += 1;

    keys.forEach((key) => {
        index[key] = (index[key] || []).concat([entry]);
    });
};

const onResponse = (name, keys, read) => {
    if (booted()) {
        console.warn(`[json] ${name} registered after interception began; it will not run`);
        return;
    }

    file(readers, name, keys, read);
};

const onRequest = (name, keys, write) => {
    if (booted()) {
        console.warn(`[json] ${name} registered after interception began; it will not run`);
        return;
    }

    file(writers, name, keys, write);
};

const matching = (value, index) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;

    const found = Object.keys(value)
        .reduce((got, key) => got.concat(index[key] || []), [])
        .filter((entry, position, all) => all.indexOf(entry) === position);

    if (!found.length) return null;

    // Registration order, not the order the keys happened to appear in. The writer pipeline
    // reduces, so for those it is the difference between a rewrite landing and being overwritten.
    return found.slice().sort((a, b) => a.id - b.id);
};

const guarded = (handler, value, fallback) => {
    try {
        return handler.handle(value);
    } catch (failure) {
        console.error(`[${handler.name}] failed:`, failure);
        return fallback;
    }
};

// A module still initialising throws on property access, so each is guarded rather than ending
// the walk.
const taken = Object.create(null);

const adopt = () => {
    window.JSON.parse = JSON.parse;
    window.JSON.stringify = JSON.stringify;

    const registry = window._yttv;
    if (!registry) return;

    Object.keys(registry).forEach((key) => {
        // Boot alone is some 240 passes over the registry. Remembering which modules have already
        // been taken makes all but the first a walk of the names rather than of their contents.
        if (taken[key]) return;

        try {
            const module = registry[key];
            if (module && module.JSON && module.JSON.parse) {
                module.JSON.parse = JSON.parse;
                module.JSON.stringify = JSON.stringify;
                taken[key] = true;
            }
        } catch (e) {}
    });
};

// The module that parses innertube responses can arrive long after boot, and until it is adopted
// no mod sees one.
const ADOPTION_WINDOW = 60000;
const ADOPTION_INTERVAL = 250;

// Navigating loads modules that did not exist at boot, so each one reopens a short window. until()
// extends the window already running rather than starting a second interval beside it.
const AFTER_NAVIGATION = 5000;

const keepAdopting = (forMs) => {
    adopt();
    until('json adoption', ADOPTION_INTERVAL, adopt, forMs);
};

const state = { intercepted: false, parse: null, stringify: null };

const nativeJson = () => ({
    parse: state.parse || JSON.parse,
    stringify: state.stringify || JSON.stringify
});

const interceptJson = () => {
    if (state.intercepted) return;
    state.intercepted = true;

    const parse = JSON.parse;
    const stringify = JSON.stringify;

    state.parse = parse;
    state.stringify = stringify;

    JSON.parse = function () {
        const response = parse.apply(this, arguments);
        const wanted = matching(response, readers);

        if (wanted) wanted.forEach((reader) => guarded(reader, response));

        return response;
    };

    JSON.stringify = function (value, replacer, space) {
        const wanted = matching(value, writers);
        if (!wanted) return stringify.call(this, value, replacer, space);

        const rewritten = wanted.reduce((current, writer) => {
            const result = guarded(writer, current, current);
            return result === undefined ? current : result;
        }, value);

        return stringify.call(this, rewritten, replacer, space);
    };

    keepAdopting(ADOPTION_WINDOW);
    window.addEventListener('hashchange', () => keepAdopting(AFTER_NAVIGATION));
};

export { onResponse, onRequest, interceptJson, nativeJson };
