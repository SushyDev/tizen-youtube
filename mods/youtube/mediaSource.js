const Real = typeof window !== 'undefined' ? window.MediaSource : null;

const soon = (run) => Promise.resolve().then(run);

const element = () => document.querySelector('video');

// The page player keeps fetching the same video and discarding it; a full buffer stops it.
let withholdingAllowed = true;

export function withholdMedia(on) {
    withholdingAllowed = on !== false;
    return withholdingAllowed;
}

export function withholdingMedia() {
    return withholdingAllowed;
}

const EMPTY = { length: 0, start: () => 0, end: () => 0 };

function oursIsPlaying(video) {
    return Boolean(video && String(video.currentSrc).indexOf('/dash/') !== -1);
}

// 60s changes nothing; 150 stops the page player's fetching entirely.
// Only the puppet lies about this. Faking buffered on the element breaks our own playback.
let aheadSeconds = 150;

export function withholdAhead(seconds) {
    aheadSeconds = Number(seconds) || 0;
    return aheadSeconds;
}

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

    // Never attached to an element, so sourceopen is synthesised. Late listeners get a direct
    // call; re-dispatching would fire every listener twice.
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

// Real createObjectURL, captured before it is replaced. Ours must use this or it recurses.
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
