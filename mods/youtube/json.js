const readers = [];
const writers = [];

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

const isInteresting = (value, index) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;

    return Object.keys(value).some((key) => index[key]);
};

const guarded = (handler, value, fallback) => {
    try {
        return handler.handle(value);
    } catch (failure) {
        console.error(`[${handler.name}] failed:`, failure);
        return fallback;
    }
};

// Reading a property off a module that is still initialising throws, and an unguarded walk ends
// there. On the set the registry holds 3116 modules and exactly one of them carries its own JSON,
// so a walk that stops early stops before the only one worth reaching.
const adopt = () => {
    window.JSON.parse = JSON.parse;
    window.JSON.stringify = JSON.stringify;

    const registry = window._yttv;
    if (!registry) return;

    Object.keys(registry).forEach((key) => {
        try {
            const module = registry[key];
            if (module && module.JSON && module.JSON.parse) {
                module.JSON.parse = JSON.parse;
                module.JSON.stringify = JSON.stringify;
            }
        } catch (e) {
            // Not ready to be patched. The next pass will find it.
        }
    });
};

// The module that parses innertube responses is not in the registry when the page starts — the app
// is still fetching two megabytes of its own code through the proxy well past fifteen seconds, and
// a window that closes before it arrives leaves every response going through YouTube's own JSON.
const ADOPTION_WINDOW = 60000;
const ADOPTION_INTERVAL = 250;

// Navigating loads modules that did not exist at boot, so each one reopens a short window instead
// of a timer being left running for the life of the page.
const AFTER_NAVIGATION = 5000;

const keepAdopting = (forMs) => {
    adopt();

    const until = Date.now() + forMs;
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

    keepAdopting(ADOPTION_WINDOW);
    window.addEventListener('hashchange', () => keepAdopting(AFTER_NAVIGATION));
};

export { onResponse, onRequest, interceptJson };
