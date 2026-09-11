import { assetUrl } from './origin.js';

const CACHE_KEY = 'tube-display-names';

function intlIsUsable() {
    try {
        return typeof Intl !== 'undefined'
            && typeof Intl.DisplayNames === 'function'
            && !!new Intl.DisplayNames(['en'], { type: 'language' });
    } catch (e) {
        return false;
    }
}

const hasIntl = intlIsUsable();

const intlLanguage = hasIntl ? new Intl.DisplayNames(['en'], { type: 'language' }) : null;
const intlRegion = hasIntl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

const fallback = { data: null };

function primeFallback() {
    if (hasIntl || fallback.data) return;

    try {
        const cached = window.localStorage.getItem(CACHE_KEY);
        if (cached) {
            fallback.data = JSON.parse(cached);
            return;
        }
    } catch (e) {
    }

    fetch(assetUrl('language-names.json'))
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
            if (!data) return;
            fallback.data = data;
            try {
                window.localStorage.setItem(CACHE_KEY, JSON.stringify(data));
            } catch (e) { }
        })
        .catch(() => { });
}

primeFallback();

export function displayLanguage(code) {
    if (!code) return code;

    if (intlLanguage) {
        try {
            const name = intlLanguage.of(code);
            if (name && name !== code) return name;
        } catch (e) { }
    }

    if (fallback.data && fallback.data.language && fallback.data.language.standard) {
        return fallback.data.language.standard.long[code] || code;
    }

    return code;
}

export function displayRegion(code) {
    if (!code) return code;

    if (intlRegion) {
        try {
            const name = intlRegion.of(String(code).toUpperCase());
            if (name && name !== code) return name;
        } catch (e) { }
    }

    if (fallback.data && fallback.data.region) {
        return fallback.data.region.long[code] || code;
    }

    return code;
}
