const Real = typeof window !== 'undefined' ? window.MediaSource : null;

// Nothing is ever appended to these, so an append completes as soon as the task queue
// turns over. The player waits for `updateend` before appending again.
const soon = (run) => Promise.resolve().then(run);

const element = () => document.querySelector('video');

// While this app feeds the element, the page's own player is still fetching the same video
// from googlevideo and appending it here, where it is thrown away. Measured on the
// television: seven requests and about 30MB a minute, a whole second copy nobody sees. It
// also makes the picture worse indirectly — those fetches compete with the service's, and
// the page's adaptive ladder reads the contention it is itself causing and steps down.
//
// Telling it the buffer is full stops it dead: zero requests for twenty-eight seconds. But
// it appends only what it fetches, so its own record of what it has appended stops growing
// too, and about forty seconds later it decides the pipeline has died and reloads the
// whole video. Pinning its quality instead does not work either — setPlaybackQualityRange
// is accepted and then overridden, with the download carrying on unchanged.
//
// So it is told the truth in bursts: held full for long enough to save most of the
// traffic, then let go for long enough to fetch and append something, which keeps its
// record up with the playhead. Both are well inside the forty seconds that ends in a
// reload.
// Switchable, because the thing this suppresses is also the thing anyone working on it
// needs to measure: with it on, the byte counts are all zero and say nothing. Off is a
// baseline, not a setting anybody watching should reach.
let withholdingAllowed = true;

export function withholdMedia(on) {
    withholdingAllowed = on !== false;
    return withholdingAllowed;
}

export function withholdingMedia() {
    return withholdingAllowed;
}

const EMPTY = { length: 0, start: () => 0, end: () => 0 };

// Only while the element is playing this app's stream. Anything else — the page's own
// playback, another app's — gets the truth.
function oursIsPlaying(video) {
    return Boolean(video && String(video.currentSrc).indexOf('/dash/') !== -1);
}

// How far ahead of the playhead the buffer is claimed to reach, for the page player alone.
//
// Sixty seconds changes nothing — it goes on fetching at the same rate, so its goal is
// larger than that. A hundred and fifty stops it dead: measured on the television at 220
// seconds of continuous playback, one 308KB request in the first eighty-seven seconds and
// nothing after, no reattach, no stall, 1.00x realtime, and the player's own Network
// Activity reading 0 KB throughout.
//
// An earlier attempt concluded this reattaches after forty seconds. That was wrong, and
// wrong in an instructive way: it faked `buffered` on the *element*, which lies to the
// platform player about the stream it is actually decoding — this app's own. Rebuilding
// the pipeline was the correct response to that. Only what the puppet reports to the page
// player is changed here; the element's real buffer is untouched.
let aheadSeconds = 150;

export function withholdAhead(seconds) {
    aheadSeconds = Number(seconds) || 0;
    return aheadSeconds;
}

// The duty cycle that used to sit here let the page player top up every eighteen seconds
// before it could decide its pipeline had died. It never does decide that, so there was
// nothing to let go for, and it is gone.
function withholding() {
    return withholdingAllowed;
}

function buffered() {
    const video = element();
    if (!video) return EMPTY;

    if (!oursIsPlaying(video) || !withholding()) return video.buffered;

    const whole = isFinite(video.duration) && video.duration > 0 ? video.duration : video.currentTime + 600;
    const end = aheadSeconds > 0 ? Math.min(video.currentTime + aheadSeconds, whole) : whole;

    return { length: 1, start: () => 0, end: () => end };
}

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
        changeType() { },
        abort() { buffer.updating = false; },

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

function puppet(source) {
    const buffers = [];
    let duration = NaN;

    // Whether the one `sourceopen` has already gone out. Listeners registered before it get
    // it from the dispatch; getting that distinction wrong calls the player's handler twice.
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

    own('endOfStream', () => { });
    own('setLiveSeekableRange', () => { });
    own('clearLiveSeekableRange', () => { });

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

// The browser's own, kept before it is replaced. Anything of ours that needs a real
// object URL has to ask for it here, or it is handed back its own answer and recurses.
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

        // A throw here would take the player's whole set-up with it, and there is always an
        // ordinary answer to fall back on.
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
