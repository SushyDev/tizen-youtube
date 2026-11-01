import { AR } from './ar.js';
import { BN } from './bn.js';
import { DE } from './de.js';
import { ES } from './es.js';
import { FR } from './fr.js';
import { HI } from './hi.js';
import { PT } from './pt.js';
import { RU } from './ru.js';
import { UR } from './ur.js';
import { ZH } from './zh.js';

// Our own words follow the language the viewer picked for YouTube: the ten most spoken languages,
// English being the one the mods are written in, and German. Tables are keyed by the base of
// YouTube's hl, so es-419 and pt-PT share es and pt, and every zh reads Simplified. A language
// with no table, or a phrase missing from one, stays in English rather than showing nothing.
const TABLES = { ar: AR, bn: BN, de: DE, es: ES, fr: FR, hi: HI, pt: PT, ru: RU, ur: UR, zh: ZH };

const fromContext = () => {
    try {
        const context = window.ytcfg && window.ytcfg.get && window.ytcfg.get('INNERTUBE_CONTEXT');
        return (context && context.client && context.client.hl) || '';
    } catch (e) {
        return '';
    }
};

// Written by our own language switch before the page reloads, and by YouTube itself.
const fromCookie = () => {
    const found = /(?:^|;\s*)PREF=[^;]*?\bhl=([A-Za-z_-]+)/.exec((typeof document !== 'undefined' && document.cookie) || '');
    return found ? found[1] : '';
};

const fromDevice = () => (typeof navigator !== 'undefined' && navigator.language) || '';

const language = () => (fromContext() || fromCookie() || fromDevice()).split(/[-_]/)[0].toLowerCase();

// Placeholders are numbered, {0} and on, so a table may put them in its own order.
const fill = (text, values) => text.replace(/\{(\d+)\}/g, (whole, at) =>
    (values && values[at] !== undefined ? String(values[at]) : whole));

const say = (text, values) => {
    if (typeof text !== 'string') return text;

    const table = TABLES[language()];
    const found = table && Object.prototype.hasOwnProperty.call(table, text) ? table[text] : text;

    return fill(found, values);
};

export { say, language, TABLES };
