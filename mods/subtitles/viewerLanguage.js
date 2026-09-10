import { displayLanguage } from './languageNames.js';

// The viewer's own language, guessed from the country on their account.
//
// YouTube says where the account is (`yt.config_.GL`) but never what it reads in. Intl.Locale
// maximises a bare region into the language most likely spoken there, which is right often enough
// to be worth offering and costs one extra row in a menu when it is wrong.
//
// Intl.Locale arrived in Chrome 74 and the engine floor here is 63, so on a set without it this
// answers nothing and the row is simply never added. That is the honest failure: a language the
// viewer can still reach from the full list below it.

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
