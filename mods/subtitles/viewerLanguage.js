import { languageName } from './languageNames.js';

// Guessed from the account country; there is no Intl.Locale before Chrome 74.

// The maximiser answers `zh`, but caption tracks are per-script, so the region picks which of the
// three to offer.
const CHINESE = { CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-HK', SG: 'zh-CN' };

const countryCode = () => window.yt?.config_?.GL || null;

const likelyLanguage = (region) => {
    try {
        const locale = new Intl.Locale('und', { region });
        const maximized = locale.maximize ? locale.maximize() : locale;
        return maximized.language || null;
    } catch (e) {
        return null;
    }
};

const viewerLanguage = () => {
    const country = countryCode();
    if (!country) return null;

    const region = String(country).toUpperCase();
    const code = CHINESE[region] || likelyLanguage(region);

    return code ? { code, name: languageName(code) } : null;
};

export { viewerLanguage };
