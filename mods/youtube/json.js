// `JSON.parse` and `JSON.stringify` are globals called tens of thousands of times a
// session, so there is one patch here: reject non-YouTube values cheaply, run each reader
// in isolation, and always return what the caller asked for.

const readers = [];
const writers = [];

// A keyed lookup beats a Set on the old webviews this also runs on.
const readable = Object.create(null);
const writable = Object.create(null);

const remember = (index, keys) => keys.forEach((key) => { index[key] = true; });

const onResponse = (name, keys, read) => {
    remember(readable, keys);
    readers.push({ name, handle: read });
};

const onRequest = (name, keys, write) => {
    remember(writable, keys);
    writers.push({ name, handle: write });
};

// `null` is an object, which is the detail that used to crash this.
const isInteresting = (value, index) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;

    for (const key in value) {
        if (index[key]) return true;
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

// A missed capture costs a feature; a permanent interval costs every frame of the session.
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
