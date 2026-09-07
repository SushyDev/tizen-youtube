import { configChangeEmitter, configRead } from '../../framework/index.js';
import theme from './oledTheme.css';
import easing from './oledFade.css';

const PALETTE = {
    '15,15,15': '0, 0, 0',
    '11,11,11': '0, 0, 0',
    '6,6,6': '0, 0, 0',
    '3,3,3': '0, 0, 0',
    '1,1,1': '0, 0, 0',

    '28,26,26': '0, 0, 0',
    '40,40,40': '0, 0, 0',

    '24,24,24': '13, 13, 13',
    '33,33,33': '22, 22, 22',
    '55,55,55': '55, 55, 55, 0.55',
    '63,63,63': '38, 38, 38',
    '87,87,87': '51, 51, 51'
};

const MUTED_LABEL = '170,170,170';
const LIFTED_LABEL = '200, 200, 200';
const PLATES = ['33,33,33', '55,55,55', '63,63,63'];


const COLOUR = /rgba?\((\d+),\s*(\d+),\s*(\d+)((?:,\s*[\d.]+)?)\)/g;

const TRANSLUCENT = /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*(?:0?\.\d+|0)\s*\)/;

function lift(value) {
    const found = /^rgba?\((\d+),\s*(\d+),\s*(\d+)((?:,\s*[\d.]+)?)\)/.exec(value);
    const alpha = found ? found[4] : '';

    return (alpha ? 'rgba(' : 'rgb(') + LIFTED_LABEL + alpha + ')';
}

export function rewrites() {
    return held.changed.map(([style, property, original]) => ({
        property,
        was: original,
        now: style.getPropertyValue(property),
        lostAlpha: /rgba\(/.test(original) && !/rgba\(/.test(style.getPropertyValue(property))
    }));
}

const held = { ground: null, curtain: null, observer: null, pending: null, changed: [], scanned: [] };

function key(value) {
    const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
    return match ? match[1] + ',' + match[2] + ',' + match[3] : null;
}

function remap(value) {
    if (value.indexOf('rgb') === -1) return value;

    if (TRANSLUCENT.test(value)) return value;

    return value.replace(COLOUR, (whole, r, g, b, alpha) => {
        const to = PALETTE[r + ',' + g + ',' + b];
        if (!to) return whole;
        if (to.split(',').length === 4) return 'rgba(' + to + ')';
        return (alpha ? 'rgba(' : 'rgb(') + to + alpha + ')';
    });
}

// A CSSStyleDeclaration is array-like over its property names, and each name has to be paired with
// the value it currently holds before anything is written back.
const declarationsOf = (style) => Array.from({ length: style.length }, (_, index) => ({
    property: style[index],
    original: style.getPropertyValue(style[index])
}));

function rewriteDeclarations(style) {
    const declarations = declarationsOf(style);

    const background = declarations.find((one) => one.property === 'background-color');
    const plate = !!background && PLATES.indexOf(key(background.original)) !== -1;

    const wanted = ({ property, original }) => (
        plate && property === 'color' && key(original) === MUTED_LABEL ? lift(original) : remap(original)
    );

    declarations.forEach((declaration) => {
        const next = wanted(declaration);
        if (next === declaration.original) return;

        const priority = style.getPropertyPriority(declaration.property);

        held.changed = held.changed.concat([[style, declaration.property, declaration.original, priority]]);
        style.setProperty(declaration.property, next, priority);
    });
}

function walkRules(rules) {
    Array.from(rules).forEach((rule) => {
        if (rule.style) rewriteDeclarations(rule.style);
        if (rule.cssRules && rule.cssRules.length) walkRules(rule.cssRules);
    });
}

// A sheet from another origin throws on cssRules; it is marked scanned so it is never asked twice.
const rulesOf = (sheet) => {
    try {
        return sheet.cssRules;
    } catch (e) {
        return null;
    }
};

function rewriteSheets() {
    Array.from(document.styleSheets)
        .filter((sheet) => held.scanned.indexOf(sheet) === -1)
        .forEach((sheet) => {
            const rules = rulesOf(sheet);

            if (rules !== null && !rules.length) return;

            held.scanned = held.scanned.concat([sheet]);
            if (rules !== null) walkRules(rules);
        });
}

function alreadyPainted() {
    const timing = window.performance;

    if (timing && typeof timing.getEntriesByType === 'function') {
        const paints = timing.getEntriesByType('paint');
        if (paints && paints.length) return true;
    }

    return document.readyState !== 'loading';
}

function styled(css) {
    const element = document.createElement('style');
    const nonced = document.querySelector('style[nonce]');

    if (nonced) element.setAttribute('nonce', nonced.nonce || nonced.getAttribute('nonce'));
    element.appendChild(document.createTextNode(css));

    return element;
}

function settling() {
    const shown = window.getComputedStyle(document.documentElement).transitionDuration || '';
    const seconds = parseFloat(shown.split(',')[0]);

    return seconds > 0 ? seconds * 1000 : 0;
}

function fade(work) {
    if (!alreadyPainted()) {
        work();
        return;
    }

    held.curtain = styled(easing);
    document.head.appendChild(held.curtain);

    void document.documentElement.offsetWidth;

    const leaving = held.curtain;
    const over = settling();

    try {
        work();
    } finally {
        setTimeout(() => {
            if (leaving === held.curtain) held.curtain = null;
            if (leaving.parentNode) leaving.parentNode.removeChild(leaving);
        }, over);
    }
}

function schedule() {
    if (held.pending) return;
    held.pending = setTimeout(() => {
        held.pending = null;
        if (configRead('enableOledTheme')) rewriteSheets();
    }, 100);
}

function watchForStylesheets() {
    if (held.observer || typeof MutationObserver !== 'function') return;

    const ours = (node) => node === held.ground || node === held.curtain;
    const isStylesheet = (node) => node.nodeName === 'STYLE' || node.nodeName === 'LINK';

    held.observer = new MutationObserver((records) => {
        const added = records.reduce((all, record) => all.concat(Array.from(record.addedNodes)), []);
        const found = added.filter((node) => !ours(node) && isStylesheet(node));

        if (!found.length) return;

        found.filter((node) => node.nodeName === 'LINK').forEach((link) => link.addEventListener('load', schedule));

        schedule();
    });

    held.observer.observe(document.head, { childList: true });
}

function enable() {
    if (held.ground) return;

    held.ground = styled(theme);

    fade(() => {
        document.head.appendChild(held.ground);

        rewriteSheets();
    });

    watchForStylesheets();
}

function disable() {
    if (!held.ground) return;

    if (held.observer) held.observer.disconnect();
    held.observer = null;
    clearTimeout(held.pending);
    held.pending = null;

    fade(() => {
        // Newest first, so a property rewritten more than once ends on the value it started with.
        held.changed.slice().reverse().forEach(([style, property, original, priority]) => {
            style.setProperty(property, original, priority);
        });

        if (held.ground.parentNode) held.ground.parentNode.removeChild(held.ground);
    });

    held.changed = [];
    held.scanned = [];
    held.ground = null;
}

function guard(work) {
    try {
        work();
    } catch (e) {
        console.warn('The OLED theme could not be applied.', e);
    }
}

const start = () => {
    if (configRead('enableOledTheme')) guard(enable);

    configChangeEmitter.addEventListener('configChange', (event) => {
        if (event.detail.key !== 'enableOledTheme') return;
        guard(event.detail.value ? enable : disable);
    });
};

export { start };
