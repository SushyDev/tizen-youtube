// Every screen arrives through `JSON.parse` and every request leaves through
// `JSON.stringify`, so owning those two functions is the entire mechanism this app is
// built on. They are globals called tens of thousands of times a session, so there is
// one patch here: reject non-YouTube values cheaply, run each reader in isolation, and
// always return what the caller asked for.

// Readers may change a parsed response in place; writers return what to serialise.
// All registration happens at import time.
const readers = [];
const writers = [];

// A keyed lookup beats a Set on the old webviews this also runs on. The parallel
// arrays exist because the guard below walks the registered keys rather than the
// value's own — see `isInteresting`.
const readable = Object.create(null);
const writable = Object.create(null);
const readableKeys = [];
const writableKeys = [];

const remember = (index, list, keys) => keys.forEach((key) => {
    if (index[key]) return;
    index[key] = true;
    list.push(key);
});

/** Registers a reader. A value naming none of `keys` never reaches `read`. */
const onResponse = (name, keys, read) => {
    remember(readable, readableKeys, keys);
    readers.push({ name, handle: read });
};

/** Registers a writer. `write` returns the value to serialise, or nothing to leave it. */
const onRequest = (name, keys, write) => {
    remember(writable, writableKeys, keys);
    writers.push({ name, handle: write });
};

// This is the hottest code in the userscript: it runs on every JSON.parse and every
// JSON.stringify the page makes, which during playback is continuous. It used to
// enumerate the value's own keys with `for...in`, which walks the prototype chain and
// materialises a key string for every property of every object YouTube parses.
// Walking the handful of registered keys instead is a fixed, small number of own-property
// lookups and allocates nothing.
//
// `null` is an object, which is the detail that used to crash this.
const isInteresting = (value, keys) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;

    for (let i = 0; i < keys.length; i++) {
        if (value[keys[i]] !== undefined) return true;
    }

    return false;
};

// A handler that throws is a bug in one feature, not a reason for the page to stop.
// Naming it makes it findable from a TV console with no debugger.
const guarded = (handler, value, fallback) => {
    try {
        return handler.handle(value);
    } catch (failure) {
        console.error(`[${handler.name}] failed:`, failure);
        return fallback;
    }
};

// YouTube's bundle captures its own references to JSON, so patching the global alone
// leaves half the responses unread — and `_yttv` fills in as the bundle registers its
// modules, after this script has run.
const adopt = () => {
    window.JSON.parse = JSON.parse;
    window.JSON.stringify = JSON.stringify;

    const registry = window._yttv;
    if (!registry) return;

    Object.keys(registry).forEach((key) => {
        const module = registry[key];
        if (module && module.JSON && module.JSON.parse) {
            module.JSON.parse = JSON.parse;
            module.JSON.stringify = JSON.stringify;
        }
    });
};

// Long enough for a cold bundle load. A missed capture costs a feature; a permanent
// interval costs every frame of the session.
const ADOPTION_WINDOW = 15000;
const ADOPTION_INTERVAL = 250;

const keepAdopting = () => {
    adopt();

    const until = Date.now() + ADOPTION_WINDOW;
    const timer = setInterval(() => {
        adopt();
        if (Date.now() > until) clearInterval(timer);
    }, ADOPTION_INTERVAL);
};

/** Installs both patches. Called once, by the module that composes features. */
const interceptJson = () => {
    const parse = JSON.parse;
    const stringify = JSON.stringify;

    JSON.parse = function () {
        const response = parse.apply(this, arguments);

        if (isInteresting(response, readableKeys)) {
            readers.forEach((reader) => guarded(reader, response));
        }

        return response;
    };

    JSON.stringify = function (value, replacer, space) {
        if (!isInteresting(value, writableKeys)) return stringify.call(this, value, replacer, space);

        const rewritten = writers.reduce((current, writer) => {
            const result = guarded(writer, current, current);
            return result === undefined ? current : result;
        }, value);

        return stringify.call(this, rewritten, replacer, space);
    };

    keepAdopting();
};

export { onResponse, onRequest, interceptJson };
