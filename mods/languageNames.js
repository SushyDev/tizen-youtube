// Human-readable language and region names.
//
// Modern Tizen webviews (Chrome 81+, so Tizen 7 and up) ship Intl.DisplayNames
// and need no data at all. Older ones fall back to a static map fetched from
// the origin and cached, rather than the 33KB the reference compiled into
// every bundle for every TV.

import { assetUrl } from './origin.js';

const CACHE_KEY = 'tube-display-names';

const hasIntl = (function () {
    try {
        return typeof Intl !== 'undefined' &&
            typeof Intl.DisplayNames === 'function' &&
            !!new Intl.DisplayNames(['en'], { type: 'language' });
    } catch (e) {
        return false;
    }
})();

const intlLanguage = hasIntl ? new Intl.DisplayNames(['en'], { type: 'language' }) : null;
const intlRegion = hasIntl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

// Populated only on webviews without Intl.DisplayNames.
let fallbackData = null;

function primeFallback() {
    if (hasIntl || fallbackData) return;

    try {
        const cached = window.localStorage.getItem(CACHE_KEY);
        if (cached) {
            fallbackData = JSON.parse(cached);
            return;
        }
    } catch (e) {
        // Fall through to the network.
    }

    fetch(assetUrl('language-names.json'))
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
            if (!data) return;
            fallbackData = data;
            try {
                window.localStorage.setItem(CACHE_KEY, JSON.stringify(data));
            } catch (e) { /* storage unavailable */ }
        })
        .catch(() => { /* callers already degrade to the raw code */ });
}

primeFallback();

// Both accessors stay synchronous and degrade to the code itself, which is
// what every call site already treats as the miss case.
export function displayLanguage(code) {
    if (!code) return code;

    if (intlLanguage) {
        try {
            const name = intlLanguage.of(code);
            if (name && name !== code) return name;
        } catch (e) { /* unknown tag */ }
    }

    if (fallbackData && fallbackData.language && fallbackData.language.standard) {
        return fallbackData.language.standard.long[code] || code;
    }

    return code;
}

export function displayRegion(code) {
    if (!code) return code;

    if (intlRegion) {
        try {
            const name = intlRegion.of(String(code).toUpperCase());
            if (name && name !== code) return name;
        } catch (e) { /* unknown region */ }
    }

    if (fallbackData && fallbackData.region) {
        return fallbackData.region.long[code] || code;
    }

    return code;
}
