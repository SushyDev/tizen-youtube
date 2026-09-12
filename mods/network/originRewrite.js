import { presentAsYouTube, realOrigin } from './pageOrigin.js';

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

// Read by hand: Cobalt 20 cannot construct a URL at all. A relative URL is already ours.
const ABSOLUTE = /^(https?:)?\/\/([^/?#:]+)(:\d+)?(.*)$/i;

function redirectUrl(originalUrl) {
    if (!originalUrl) return originalUrl;

    const parts = ABSOLUTE.exec(String(originalUrl));
    if (!parts) return originalUrl;

    const [, scheme, host, port, rest] = parts;
    const hostname = host.toLowerCase();

    if (OURS.indexOf(hostname) !== -1) return `${realOrigin()}${rest || '/'}`;

    if (throughTheService(hostname)) {
        return `${realOrigin()}/cors-bypass/${scheme || 'https:'}//${host}${port || ''}${rest}`;
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

    // @ts-expect-error — open() is overloaded with optional trailing arguments; the patch takes
    // whatever it was handed and passes it straight through.
    XMLHttpRequest.prototype.open = function patchedOpen(method, url, async, user, password) {
        return originalOpen.call(this, method, redirectUrl(url),
            async === undefined ? true : async, user, password);
    };

    redirectOnAssignment(HTMLScriptElement, 'src');
}

const start = () => {
    if (typeof window === 'undefined' || window.location.protocol !== 'http:') return;
    installProxyPatches();
    presentAsYouTube();
};

export { redirectUrl, start };
