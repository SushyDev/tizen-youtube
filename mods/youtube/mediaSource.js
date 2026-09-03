// A MediaSource the player can go on believing in, so the element can be given a URL
// instead. Appends are accepted and dropped; buffering reads back from the element, which
// is the truth about what is playing.

const Real = typeof window !== 'undefined' ? window.MediaSource : null;

// Nothing is ever appended to these, so an append completes as soon as the task queue
// turns over. The player waits for `updateend` before appending again.
const soon = (run) => Promise.resolve().then(run);

/** The element the player is driving, which is where buffering truth lives. */
const element = () => document.querySelector('video');

// What the player reads back about buffering is the element's own, which is the truth about
// what is playing.
//
// Telling it more than that was tried, to stop it fetching media nothing would play: it
// does stop, and then reloads the whole video every fifteen seconds, because a player that
// has appended nothing decides its pipeline has died. Its fetching is the price of it
// believing itself alive.
function buffered() {
    const video = element();
    return video ? video.buffered : { length: 0, start: () => 0, end: () => 0 };
}

/** A source buffer that accepts everything and keeps none of it. */
function puppetBuffer(mimeType) {
    const target = new EventTarget();

    const buffer = {
        mimeType,
        updating: false,
        mode: 'segments',
        timestampOffset: 0,
        appendWindowStart: 0,
        appendWindowEnd: Infinity,

        get buffered() { return buffered(); },

        appendBuffer() { buffer.finish(); },
        remove() { buffer.finish(); },
        changeType() { /* the element decides what it is playing */ },
        abort() { buffer.updating = false; },

        /** The pair of events the player waits on before it will append again. */
        finish() {
            buffer.updating = true;
            soon(() => {
                buffer.updating = false;
                target.dispatchEvent(new Event('update'));
                target.dispatchEvent(new Event('updateend'));
            });
        },

        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
        dispatchEvent: target.dispatchEvent.bind(target)
    };

    return buffer;
}

/**
 * Turns a real MediaSource into one that reports itself open and hands back buffers that
 * swallow what they are given. The instance stays a real MediaSource, so everything that
 * tests it with `instanceof` still agrees.
 */
function puppet(source) {
    const buffers = [];
    let duration = NaN;

    // Whether the one `sourceopen` has already gone out. Listeners registered before it get
    // it from the dispatch; only ones that arrive afterwards need telling directly, and
    // getting that distinction wrong calls the player's handler twice.
    let announced = false;

    const own = (name, value) => Object.defineProperty(source, name, { configurable: true, value });
    const reads = (name, get) => Object.defineProperty(source, name, { configurable: true, get });

    reads('readyState', () => 'open');
    reads('sourceBuffers', () => buffers);
    reads('activeSourceBuffers', () => buffers);

    Object.defineProperty(source, 'duration', {
        configurable: true,
        get: () => duration,
        set: (value) => { duration = value; }
    });

    own('addSourceBuffer', (mimeType) => {
        const buffer = puppetBuffer(mimeType);
        buffers.push(buffer);
        return buffer;
    });

    own('removeSourceBuffer', (buffer) => {
        const at = buffers.indexOf(buffer);
        if (at !== -1) buffers.splice(at, 1);
    });

    own('endOfStream', () => { /* the element reaches its own end */ });
    own('setLiveSeekableRange', () => { /* not a live stream */ });
    own('clearLiveSeekableRange', () => { /* not a live stream */ });

    // This source is never attached to an element, so `sourceopen` has to be made. A
    // latecomer is called directly: dispatching again would tell everyone twice.
    const listen = source.addEventListener.bind(source);

    const call = (handler) => soon(() => {
        try {
            if (typeof handler === 'function') handler.call(source, new Event('sourceopen'));
            else if (handler && typeof handler.handleEvent === 'function') handler.handleEvent(new Event('sourceopen'));
        } catch (e) {
            console.error('[mediaSource] a sourceopen handler failed:', e);
        }
    });

    own('addEventListener', (type, handler, options) => {
        listen(type, handler, options);
        if (type === 'sourceopen' && announced) call(handler);
    });

    // Some players assign the handler rather than adding a listener.
    let assigned = null;
    Object.defineProperty(source, 'onsourceopen', {
        configurable: true,
        get: () => assigned,
        set: (handler) => {
            assigned = handler;
            if (announced) call(handler);
        }
    });

    soon(() => {
        source.dispatchEvent(new Event('sourceopen'));
        announced = true;
    });

    return source;
}

/**
 * Installs the swap. `urlFor` is asked what the element should play instead of a blob; it
 * returns nothing when there is nothing to play, and then everything behaves as it always
 * did — which is what happens off this television.
 */
// The browser's own, kept before it is replaced. Anything of ours that needs a real object
// URL — a MediaSource this app drives itself, say — has to ask for it here, or it would be
// handed back its own answer and recurse.
let realObjectURL = typeof URL !== 'undefined' && URL.createObjectURL
    ? URL.createObjectURL.bind(URL)
    : null;

export const objectURLFor = (value) => (realObjectURL ? realObjectURL(value) : null);

export function replaceMediaSource(urlFor) {
    if (!Real || typeof URL === 'undefined' || !URL.createObjectURL) return false;

    const createObjectURL = URL.createObjectURL.bind(URL);
    realObjectURL = createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    const ours = new Set();

    URL.createObjectURL = function (value) {
        if (!(value instanceof Real)) return createObjectURL(value);

        // Whatever decides this reaches into the page, and a throw here would take the
        // player's whole set-up with it. There is always an ordinary answer to fall back on.
        let url = null;
        try {
            url = urlFor();
        } catch (e) {
            url = null;
        }

        if (!url) return createObjectURL(value);

        ours.add(url);
        puppet(value);

        return url;
    };

    URL.revokeObjectURL = function (url) {
        if (ours.has(url)) {
            ours.delete(url);
            return;
        }

        return revokeObjectURL(url);
    };

    return true;
}
