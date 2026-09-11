import { displayLanguage } from './languageNames.js';

// The viewer's language, guessed from the account country; none without Intl.Locale (Chrome 74).

// The one case the maximiser gets wrong for this purpose. It answers `zh`, but caption tracks are
// per-script, so the region has to pick which of the three to offer.
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

    return code ? { code, name: displayLanguage(code) } : null;
};

export { viewerLanguage };
