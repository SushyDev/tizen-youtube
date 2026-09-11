// Hosts that refuse the page's origin are fetched through the service's /cors-bypass/ route.
const PROXIED = [
    'googlevideo.com',
    'googleapis.com',
    'google.com',
    'gstatic.com',
    'ggpht.com',
    'googleusercontent.com'
];

const OURS = ['youtube.com', 'www.youtube.com'];

const throughTheService = (hostname) =>
    PROXIED.some((host) => hostname === host || hostname.endsWith(`.${host}`));

function redirectUrl(originalUrl) {
    if (!originalUrl) return originalUrl;

    try {
        const text = String(originalUrl);
        const url = new URL(text.indexOf('//') === 0 ? `https:${text}` : text, window.location.origin);

        // Cobalt's URL setters corrupt the URL, so results are concatenated.
        if (OURS.indexOf(url.hostname) !== -1) {
            return `${window.location.origin}${url.pathname}${url.search}${url.hash}`;
        }

        if (throughTheService(url.hostname)) {
            return `${window.location.origin}/cors-bypass/${url.toString()}`;
        }
    } catch (e) {
        // An unparseable URL is the page's business, not ours.
    }

    return originalUrl;
}

// Redirects on assignment without taking the property over: a bare `set` drops the getter, and
// reading el.src afterwards gives undefined.
const redirectOnAssignment = (kind, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(kind.prototype, name);
    if (!descriptor || typeof descriptor.set !== 'function') return;

    Object.defineProperty(kind.prototype, name, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) { descriptor.set.call(this, redirectUrl(value)); }
    });
};

export default function installProxyPatches() {
    if (window.__TUBE_NATIVE_PROXY_PATCHES__ === false) return;

    const originalFetch = window.fetch;

    if (originalFetch) {
        window.fetch = function patchedFetch(input, init) {
            if (typeof input === 'string') return originalFetch.call(this, redirectUrl(input), init);
            if (input instanceof URL) return originalFetch.call(this, redirectUrl(input.toString()), init);

            if (input instanceof Request) {
                const to = redirectUrl(input.url);
                return originalFetch.call(this, to === input.url ? input : new Request(to, input), init);
            }

            return originalFetch.call(this, input, init);
        };
    }

    const originalOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url, async, user, password) {
        return originalOpen.call(this, method, redirectUrl(url),
            async === undefined ? true : async, user, password);
    };

    redirectOnAssignment(HTMLScriptElement, 'src');
}

// Installs at import so fetch is patched before any other module captures it.
if (typeof window !== 'undefined' && window.location.protocol === 'http:') {
    installProxyPatches();
}
