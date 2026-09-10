import { displayLanguage, displayRegion } from './languageNames.js';

// Every language YouTube will auto-translate a caption track into, named for a menu.
//
// The codes are the fixed part. The names are not: Intl.DisplayNames is asked for them where the
// engine has it, and a set without it falls back to a table fetched from our own origin, which may
// not have arrived yet at import. So this is built when it is first asked for.

const CODES = [
    'af', 'sq', 'am', 'ar', 'hy', 'as', 'az', 'eu', 'be', 'bn', 'bs', 'bg',
    'my', 'ca', 'zh-CN', 'zh-TW', 'zh-HK', 'hr', 'cs', 'da', 'nl', 'en', 'et',
    'fil', 'fi', 'fr', 'gl', 'ka', 'de', 'el', 'gu', 'he', 'hi', 'hu', 'is',
    'id', 'ga', 'it', 'ja', 'kn', 'kk', 'km', 'ko', 'ky', 'lo', 'lv', 'lt',
    'mk', 'ms', 'ml', 'mt', 'mr', 'mn', 'ne', 'no', 'or', 'fa', 'pl', 'pt',
    'pa', 'ro', 'ru', 'sr', 'si', 'sk', 'sl', 'es', 'sw', 'sv', 'ta', 'te',
    'th', 'tr', 'uk', 'ur', 'uz', 'vi', 'cy', 'yi', 'yo', 'zu'
];

// zh-CN and the other two are a language and a region together: named as "Chinese (China)" rather
// than as a code nobody reads. Both lookups answer with the code itself when they cannot do better.
const nameOf = (code) => {
    const parts = code.split('-');
    return parts.length === 1
        ? displayLanguage(code)
        : `${displayLanguage(parts[0])} (${displayRegion(parts[1])})`;
};

// Alphabetical by the name that will be shown, not by the code behind it.
const allLanguages = () => CODES
    .map((code) => ({ code, name: nameOf(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));

export { allLanguages };
