import { LANGUAGE_NAMES } from './languageNames.js';

// Every language YouTube will auto-translate a caption track into, alphabetical by its name.

const CATALOGUE = Object.keys(LANGUAGE_NAMES)
    .map((code) => ({ code, name: LANGUAGE_NAMES[code] }))
    .sort((a, b) => a.name.localeCompare(b.name));

const allLanguages = () => CATALOGUE;

export { allLanguages };
