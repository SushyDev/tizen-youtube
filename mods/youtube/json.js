// The app's JSON, on the way in and on the way out.
//
// YouTube's television client has no plugin points and no useful events, but
// every screen it draws arrives as JSON handed to `JSON.parse`, and every
// request it makes leaves through `JSON.stringify`. Owning those two functions
// is therefore the entire mechanism this app is built on: change what comes
// back and the interface changes with it; change what goes out and the server
// answers differently. Not one line of YouTube's own code is touched.
//
// They are globals, though, and that is the danger. Both are called by code
// this app never sees, on data that has nothing to do with YouTube, tens of
// thousands of times a session. So there is exactly one patch here rather than
// one per feature, and three rules hold before anything clever happens:
//
//   · reject, as cheaply as possible, everything that is not YouTube's;
//   · run each reader in isolation, so one that throws cannot take the page
//     down with it;
//   · always return what the caller asked for, whatever happened above.
//
// The arrangement this replaces broke all three. Two modules patched
// `JSON.parse` independently, and the second dereferenced `r.items[0]` behind
// a check that only proved `r.items` was an array — so parsing `{"items":[]}`,
// from anywhere in the app, threw. So did parsing `null`.

// Readers see a parsed response and may change it in place. Writers see a
// value about to be serialised and return what should be serialised instead.
// Registration is the only mutable state in this file, and all of it happens
// at import time, before a single call is intercepted.
const readers = [];
const writers = [];

// The union of every registered handler's keys, as a plain object: a keyed
// lookup beats a Set on the old webviews this also runs on, and needs no
// polyfill to exist there at all.
const readable = Object.create(null);
const writable = Object.create(null);

const remember = (index, keys) => keys.forEach((key) => { index[key] = true; });

/**
 * Registers a reader.
 *
 * `keys` names the top-level properties that mean "this response is one I care
 * about". A value naming none of them never reaches `read`, which is what
 * keeps the cost of owning `JSON.parse` close to zero.
 */
const onResponse = (name, keys, read) => {
    remember(readable, keys);
    readers.push({ name, handle: read });
};

/**
 * Registers a writer. Same contract, except `write` returns the value to
 * serialise — returning nothing leaves the original alone.
 */
const onRequest = (name, keys, write) => {
    remember(writable, keys);
    writers.push({ name, handle: write });
};

// True only for a plain object carrying at least one key some handler wants.
// Arrays and primitives are the overwhelming majority of what goes past, and
// `null` is an object, which is the detail that used to crash this.
const isInteresting = (value, index) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;

    for (const key in value) {
        if (index[key]) return true;
    }

    return false;
};

// A handler that throws is a bug in one feature, not a reason for the page to
// stop working. Naming it in the log is what makes it findable from a TV's
// console, where there is no debugger and no source map.
const guarded = (handler, value, fallback) => {
    try {
        return handler.handle(value);
    } catch (failure) {
        console.error(`[${handler.name}] failed:`, failure);
        return fallback;
    }
};

// YouTube's bundle captures its own references to JSON, so patching the global
// alone leaves those untouched and half the responses unread. Adopting them is
// unavoidable; doing it once at import time is not enough, because `_yttv`
// fills in as the bundle registers its modules — which happens after this
// script has already run on the injected path.
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

// Long enough to cover a cold bundle load, short enough to stop before it
// could matter. A missed capture costs a feature; a permanent interval costs
// every frame for the life of the session.
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

        if (isInteresting(response, readable)) {
            readers.forEach((reader) => guarded(reader, response));
        }

        return response;
    };

    JSON.stringify = function (value, replacer, space) {
        if (!isInteresting(value, writable)) return stringify.call(this, value, replacer, space);

        const rewritten = writers.reduce((current, writer) => {
            const result = guarded(writer, current, current);
            return result === undefined ? current : result;
        }, value);

        return stringify.call(this, rewritten, replacer, space);
    };

    keepAdopting();
};

export { onResponse, onRequest, interceptJson };
