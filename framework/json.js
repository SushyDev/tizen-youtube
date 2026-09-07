import { until, running } from './schedule.js';
import { booted } from './register.js';

// Every handler's keys used to be merged into one set, and a root carrying any key in that union
// ran every handler — so a browse response woke the quality settler and the guide filter alike,
// and each re-checked its own shape by hand. The keys are a dispatch index now: a handler is
// called only for a root that actually carries one of the keys it asked for.
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
    if (booted()) console.warn(`[json] ${name} registered after interception began; it will not run`);
    file(readers, name, keys, read);
};

const onRequest = (name, keys, write) => {
    if (booted()) console.warn(`[json] ${name} registered after interception began; it will not run`);
    file(writers, name, keys, write);
};

const matching = (value, index) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;

    const keys = Object.keys(value);
    const seen = Object.create(null);

    const found = keys.reduce((got, key) => {
        const bucket = index[key];
        if (!bucket) return got;

        return got.concat(bucket.filter((entry) => {
            if (seen[entry.id]) return false;
            seen[entry.id] = true;
            return true;
        }));
    }, []);

    if (!found.length) return null;

    // Registration order, not the order the keys happened to appear in. The writer pipeline
    // reduces, so for those it is the difference between a rewrite landing and being overwritten.
    return found.sort((a, b) => a.id - b.id);
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
// extends the window already running rather than starting a second interval beside it, which is
// what rapid navigation used to do.
const AFTER_NAVIGATION = 5000;

const keepAdopting = (forMs) => {
    adopt();
    until('json adoption', ADOPTION_INTERVAL, adopt, forMs);
};

const state = { intercepted: false };

const interceptJson = () => {
    if (state.intercepted) return;
    state.intercepted = true;

    const parse = JSON.parse;
    const stringify = JSON.stringify;

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

const adopting = () => running('json adoption');

export { onResponse, onRequest, interceptJson, adopting };
