import { configRead, configChangeEmitter } from '../config.js';

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

const SPLASH_GROUND = [40, 40, 40];

const COLOUR = /rgba?\((\d+),\s*(\d+),\s*(\d+)((?:,\s*[\d.]+)?)\)/g;

const TRANSLUCENT = /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*(?:0?\.\d+|0)\s*\)/;

function lift(value) {
    const found = /^rgba?\((\d+),\s*(\d+),\s*(\d+)((?:,\s*[\d.]+)?)\)/.exec(value);
    const alpha = found ? found[4] : '';

    return (alpha ? 'rgba(' : 'rgb(') + LIFTED_LABEL + alpha + ')';
}

const changed = [];

export function rewrites() {
    return changed.map(([style, property, original]) => ({
        property,
        was: original,
        now: style.getPropertyValue(property),
        lostAlpha: /rgba\(/.test(original) && !/rgba\(/.test(style.getPropertyValue(property))
    }));
}
const scanned = [];

let ground = null;
let curtain = null;
let observer = null;
let pending = null;

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

function rewriteDeclarations(style) {
    const properties = [];
    const values = [];
    for (let i = 0; i < style.length; i++) {
        properties.push(style[i]);
        values.push(style.getPropertyValue(style[i]));
    }

    const background = properties.indexOf('background-color');
    const plate = background !== -1 && PLATES.indexOf(key(values[background])) !== -1;

    for (let i = 0; i < properties.length; i++) {
        const property = properties[i];
        const original = values[i];

        const next = plate && property === 'color' && key(original) === MUTED_LABEL
            ? lift(original)
            : remap(original);

        if (next === original) continue;

        const priority = style.getPropertyPriority(property);
        changed.push([style, property, original, priority]);
        style.setProperty(property, next, priority);
    }
}

function walkRules(rules) {
    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        if (rule.style) rewriteDeclarations(rule.style);

        if (rule.cssRules && rule.cssRules.length) walkRules(rule.cssRules);
    }
}

function rewriteSheets() {
    const sheets = document.styleSheets;

    for (let i = 0; i < sheets.length; i++) {
        const sheet = sheets[i];
        if (scanned.indexOf(sheet) !== -1) continue;

        let rules;
        try {
            rules = sheet.cssRules;
        } catch (e) {
            scanned.push(sheet);
            continue;
        }

        if (!rules || !rules.length) continue;

        scanned.push(sheet);
        walkRules(rules);
    }
}

let crcTable = null;

function crc32(bytes, from, to) {
    if (!crcTable) {
        crcTable = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            crcTable[n] = c;
        }
    }

    let c = -1;
    for (let i = from; i < to; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function readUint32(bytes, at) {
    return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function writeUint32(bytes, at, value) {
    bytes[at] = (value >>> 24) & 0xff;
    bytes[at + 1] = (value >>> 16) & 0xff;
    bytes[at + 2] = (value >>> 8) & 0xff;
    bytes[at + 3] = value & 0xff;
}

function decodeBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function encodeBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 4096) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
    }
    return btoa(binary);
}

function chunks(bytes) {
    const list = [];
    let at = 8;

    while (at + 12 <= bytes.length) {
        const length = readUint32(bytes, at);
        const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);

        list.push({ type, at, length });
        if (type === 'IEND') break;

        at += 12 + length;
    }

    return list;
}

function find(list, type) {
    for (let i = 0; i < list.length; i++) {
        if (list[i].type === type) return list[i];
    }
    return null;
}

function chunk(type, data) {
    const made = new Uint8Array(12 + data.length);

    writeUint32(made, 0, data.length);
    for (let i = 0; i < 4; i++) made[4 + i] = type.charCodeAt(i);
    made.set(data, 8);
    writeUint32(made, 8 + data.length, crc32(made, 4, 8 + data.length));

    return made;
}

function spliced(bytes, made, at, dropping) {
    const out = new Uint8Array(bytes.length - dropping + made.length);

    out.set(bytes.subarray(0, at), 0);
    out.set(made, at);
    out.set(bytes.subarray(at + dropping), at + made.length);

    return out;
}

function transparentGround(bytes, ground) {
    const list = chunks(bytes);
    const idat = find(list, 'IDAT');
    if (!idat) return null;

    const trns = find(list, 'tRNS');
    let alphas = null;

    if (bytes[25] === 3) {
        const plte = find(list, 'PLTE');
        if (!plte) return null;

        const matches = [];
        for (let i = 0; i * 3 + 2 < plte.length; i++) {
            const at = plte.at + 8 + i * 3;
            if (bytes[at] !== ground[0] || bytes[at + 1] !== ground[1] || bytes[at + 2] !== ground[2]) continue;
            matches.push(i);
        }
        if (!matches.length) return null;

        alphas = new Uint8Array(matches[matches.length - 1] + 1);
        for (let i = 0; i < alphas.length; i++) {
            alphas[i] = trns && i < trns.length ? bytes[trns.at + 8 + i] : 255;
        }
        matches.forEach((i) => { alphas[i] = 0; });
    } else if (bytes[25] === 2) {
        alphas = new Uint8Array([0, ground[0], 0, ground[1], 0, ground[2]]);
    } else {
        return null;
    }

    return trns
        ? spliced(bytes, chunk('tRNS', alphas), trns.at, 12 + trns.length)
        : spliced(bytes, chunk('tRNS', alphas), idat.at, 0);
}

function repaintPalette(bytes, from, to) {
    const list = chunks(bytes);
    const plte = find(list, 'PLTE');
    if (!plte) return false;

    let touched = false;
    for (let i = plte.at + 8; i + 2 < plte.at + 8 + plte.length; i += 3) {
        if (bytes[i] !== from[0] || bytes[i + 1] !== from[1] || bytes[i + 2] !== from[2]) continue;
        bytes[i] = to[0];
        bytes[i + 1] = to[1];
        bytes[i + 2] = to[2];
        touched = true;
    }
    if (!touched) return false;

    writeUint32(bytes, plte.at + 8 + plte.length, crc32(bytes, plte.at + 4, plte.at + 8 + plte.length));
    return true;
}

function behind(loader) {
    const ground = SPLASH_GROUND.join(',');
    const shown = window.getComputedStyle(loader).backgroundColor;

    if (key(shown) === ground) return true;
    if (!TRANSLUCENT.test(shown) || !document.body) return false;

    return key(window.getComputedStyle(document.body).backgroundColor) === ground;
}

function blackenSplash() {
    const loader = document.getElementById('loader');
    if (!loader) return;

    loader.style.setProperty('background-color', '#000', 'important');

    const match = /url\(["']?data:image\/png;base64,([^"')]+)/
        .exec(window.getComputedStyle(loader).backgroundImage || '');
    if (!match) return;

    let painted = null;

    try {
        const bytes = decodeBase64(match[1]);

        painted = behind(loader) ? transparentGround(bytes, SPLASH_GROUND) : null;

        if (!painted && repaintPalette(bytes, SPLASH_GROUND, [0, 0, 0])) painted = bytes;
    } catch (e) { }

    loader.style.setProperty('background-image',
        painted ? 'url(data:image/png;base64,' + encodeBase64(painted) + ')' : 'none', 'important');
}

function restoreSplash() {
    const loader = document.getElementById('loader');
    if (!loader) return;
    loader.style.removeProperty('background-color');
    loader.style.removeProperty('background-image');
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

    curtain = styled(easing);
    document.head.appendChild(curtain);

    void document.documentElement.offsetWidth;

    const leaving = curtain;
    const over = settling();

    try {
        work();
    } finally {
        setTimeout(() => {
            if (leaving === curtain) curtain = null;
            if (leaving.parentNode) leaving.parentNode.removeChild(leaving);
        }, over);
    }
}

function schedule() {
    if (pending) return;
    pending = setTimeout(() => {
        pending = null;
        if (configRead('enableOledTheme')) rewriteSheets();
    }, 100);
}

function watchForStylesheets() {
    if (observer || typeof MutationObserver !== 'function') return;

    observer = new MutationObserver((records) => {
        for (let i = 0; i < records.length; i++) {
            const added = records[i].addedNodes;
            for (let j = 0; j < added.length; j++) {
                const node = added[j];
                if (node === ground || node === curtain) continue;
                if (node.nodeName !== 'STYLE' && node.nodeName !== 'LINK') continue;
                if (node.nodeName === 'LINK') node.addEventListener('load', schedule);
                schedule();
                return;
            }
        }
    });

    observer.observe(document.head, { childList: true });
}

function enable() {
    if (ground) return;

    ground = styled(theme);

    fade(() => {
        document.head.appendChild(ground);

        blackenSplash();
        rewriteSheets();
    });

    watchForStylesheets();
}

function disable() {
    if (!ground) return;

    if (observer) {
        observer.disconnect();
        observer = null;
    }
    if (pending) {
        clearTimeout(pending);
        pending = null;
    }

    fade(() => {
        for (let i = changed.length - 1; i >= 0; i--) {
            const entry = changed[i];
            entry[0].setProperty(entry[1], entry[2], entry[3]);
        }

        if (ground.parentNode) ground.parentNode.removeChild(ground);

        restoreSplash();
    });

    changed.length = 0;
    scanned.length = 0;
    ground = null;
}

function guard(work) {
    try {
        work();
    } catch (e) {
        console.warn('The OLED theme could not be applied.', e);
    }
}

if (configRead('enableOledTheme')) guard(enable);

configChangeEmitter.addEventListener('configChange', (event) => {
    if (event.detail.key !== 'enableOledTheme') return;
    guard(event.detail.value ? enable : disable);
});
