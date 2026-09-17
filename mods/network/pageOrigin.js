// googlevideo refuses the attestation token minted for a foreign page, so the page is told it is www.youtube.com while the engine still loads from the real address.

const PRESENTED = 'https://www.youtube.com';
const PRESENTED_HOST = 'www.youtube.com';

const state = { real: null };

const realOrigin = () => state.real || window.location.origin;

const toPresented = (href) => {
    const text = String(href);
    return state.real && text.indexOf(state.real) === 0 ? PRESENTED + text.slice(state.real.length) : text;
};

// What the page assigns back is sent to the real address, so it never navigates away.
const toReal = (href) => {
    const text = String(href);
    return state.real && text.indexOf(PRESENTED) === 0 ? state.real + text.slice(PRESENTED.length) : href;
};

// A browser keeps location unforgeable; Cobalt 20 leaves every part of it configurable.
const forgeable = (location) => {
    const href = Object.getOwnPropertyDescriptor(location, 'href');
    return !!href && href.configurable && typeof href.get === 'function';
};

const presentAsYouTube = () => {
    const location = window.location;
    if (state.real || location.protocol !== 'http:' || !forgeable(location)) return false;

    const href = Object.getOwnPropertyDescriptor(location, 'href');
    const assign = location.assign;
    const replace = location.replace;

    state.real = location.origin;

    const presented = (key, get) => Object.defineProperty(location, key, {
        configurable: true,
        enumerable: true,
        get,
        set: () => undefined
    });

    Object.defineProperty(location, 'href', {
        configurable: true,
        enumerable: true,
        get: () => toPresented(href.get.call(location)),
        set: (value) => href.set.call(location, toReal(value))
    });

    presented('origin', () => PRESENTED);
    presented('protocol', () => 'https:');
    presented('host', () => PRESENTED_HOST);
    presented('hostname', () => PRESENTED_HOST);
    presented('port', () => '');

    location.assign = (url) => assign.call(location, toReal(url));
    location.replace = (url) => replace.call(location, toReal(url));
    location.toString = () => location.href;

    const Doc = window.Document;
    const url = typeof Doc === 'function' && Object.getOwnPropertyDescriptor(Doc.prototype, 'URL');
    if (url && url.configurable && url.get) {
        Object.defineProperty(Doc.prototype, 'URL', {
            configurable: true,
            enumerable: url.enumerable,
            get() { return toPresented(url.get.call(this)); }
        });
    }

    return true;
};

export { presentAsYouTube, realOrigin, PRESENTED };
