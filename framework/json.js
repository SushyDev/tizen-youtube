import { until } from './schedule.js';
import { booted } from './register.js';
import { report, warn } from './journal.js';

// Captured before interception so clone() never re-enters the readers.
const original = { parse: JSON.parse, stringify: JSON.stringify };

const clone = (value) => original.parse(original.stringify(value));

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
        warn('json', `${name} registered after interception began; it will not run`);
        return;
    }

    file(readers, name, keys, read);
};

const onRequest = (name, keys, write) => {
    if (booted()) {
        warn('json', `${name} registered after interception began; it will not run`);
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

    // Registration order, not key order: the writer pipeline reduces, so a rewrite would otherwise
    // be overwritten.
    return found.slice().sort((a, b) => a.id - b.id);
};

const guarded = (handler, value, fallback) => {
    try {
        return handler.handle(value);
    } catch (failure) {
        report(handler.name, 'failed', failure);
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
        // Boot alone is some 240 passes over the registry, so modules already taken are skipped.
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

// Navigating loads modules that did not exist at boot, so each navigation reopens a short window.
const AFTER_NAVIGATION = 5000;

const keepAdopting = (forMs) => {
    adopt();
    until('json adoption', ADOPTION_INTERVAL, adopt, forMs);
};

const state = { intercepted: false };

const interceptJson = () => {
    if (state.intercepted) return;
    state.intercepted = true;

    JSON.parse = function () {
        const response = original.parse.apply(this, arguments);
        const wanted = matching(response, readers);

        if (wanted) wanted.forEach((reader) => guarded(reader, response));

        return response;
    };

    JSON.stringify = function (value, replacer, space) {
        const wanted = matching(value, writers);
        if (!wanted) return original.stringify.call(this, value, replacer, space);

        const rewritten = wanted.reduce((current, writer) => {
            const result = guarded(writer, current, current);
            return result === undefined ? current : result;
        }, value);

        return original.stringify.call(this, rewritten, replacer, space);
    };

    keepAdopting(ADOPTION_WINDOW);
    window.addEventListener('hashchange', () => keepAdopting(AFTER_NAVIGATION));
};

// The unpatched pair, for code that must not be seen by our own hooks.
const nativeJson = () => ({ parse: original.parse, stringify: original.stringify });

export { onResponse, onRequest, interceptJson, clone, nativeJson };
