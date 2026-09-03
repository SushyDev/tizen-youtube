// Matched on colour rather than on selector: YouTube's class names are per-build hashes,
// and the palette underneath them barely moves.

import { configRead, configChangeEmitter } from '../config.js';

// Lower than the contrast formula gives, because its term for light thrown back off the
// screen overstates the lift an OLED showing black needs. Settled by looking at them.
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
    '55,55,55': '31, 31, 31',
    '63,63,63': '38, 38, 38',
    '87,87,87': '51, 51, 51'
};

// Only where one rule paints both the plate and the label. #aaa on its own is the
// secondary text of the whole app, and lifting that flattens every view count into the
// title above it.
const MUTED_LABEL = '170,170,170';
const LIFTED_LABEL = 'rgb(200, 200, 200)';
const PLATES = ['33,33,33', '55,55,55', '63,63,63'];

// Two things the cascade cannot reach: the ground, which has to be black before any of
// YouTube's stylesheets arrive, and the inline placeholder every thumbnail carries.
// Matched on the colour rather than the element, because the same element draws the
// wordmark with no placeholder behind it and painting one in boxes the logo in grey.
const GROUND_CSS =
    'html, body { background-color: #000; }\n' +
    'ytlr-thumbnail-details[style*="rgb(33, 33, 33)"] { background-color: #161616 !important; }\n';

const SPLASH_GROUND = [40, 40, 40];

const COLOUR = /rgba?\((\d+),\s*(\d+),\s*(\d+)((?:,\s*[\d.]+)?)\)/g;

// The mapping is many-to-one, so there is nothing to invert: turning the setting off has
// to put back what each declaration said.
const changed = [];
const scanned = [];

let ground = null;
let observer = null;
let pending = null;

function key(value) {
    const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
    return match ? match[1] + ',' + match[2] + ',' + match[3] : null;
}

function remap(value) {
    // Cheaper than running the pattern over all twenty-odd thousand declarations.
    if (value.indexOf('rgb') === -1) return value;

    return value.replace(COLOUR, (whole, r, g, b, alpha) => {
        const to = PALETTE[r + ',' + g + ',' + b];
        if (!to) return whole;
        return (alpha ? 'rgba(' : 'rgb(') + to + alpha + ')';
    });
}

function rewriteDeclarations(style) {
    // Both lists in full before anything is written: setProperty renumbers the block
    // underneath a loop reading it by index.
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
            ? LIFTED_LABEL
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

        // @media, @supports and nested rules all carry children, and on an engine with CSS
        // nesting a plain style rule reports an empty list rather than none at all.
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
            // A cross-origin stylesheet: nothing to read, and nothing to come back for.
            scanned.push(sheet);
            continue;
        }

        // A <link> appended but not loaded reports no rules. Leaving it unmarked is what brings
        // us back to it once it has them.
        if (!rules || !rules.length) continue;

        scanned.push(sheet);
        walkRules(rules);
    }
}

// The splash is a wordmark baked into an opaque PNG on a #282828 ground, which is 41% of
// its pixels and 60% of the screen. It is palette-indexed, so recolouring it is three
// bytes in PLTE and a fresh CRC; anything else shaped differently is dropped instead.

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
    // In slices: String.fromCharCode.apply with fifteen thousand arguments overflows the
    // stack on the engines this has to run on.
    for (let i = 0; i < bytes.length; i += 4096) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
    }
    return btoa(binary);
}

function repaintPalette(bytes, from, to) {
    let at = 8;

    while (at + 8 <= bytes.length) {
        const length = readUint32(bytes, at);
        const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);

        if (type === 'PLTE') {
            let touched = false;
            for (let i = at + 8; i + 2 < at + 8 + length; i += 3) {
                if (bytes[i] !== from[0] || bytes[i + 1] !== from[1] || bytes[i + 2] !== from[2]) continue;
                bytes[i] = to[0];
                bytes[i + 1] = to[1];
                bytes[i + 2] = to[2];
                touched = true;
            }
            if (!touched) return false;

            // The CRC covers the type and the data, not the length that precedes them.
            writeUint32(bytes, at + 8 + length, crc32(bytes, at + 4, at + 8 + length));
            return true;
        }

        // PLTE comes before the image data in every valid PNG, so either of these means there is
        // no palette to repaint.
        if (type === 'IDAT' || type === 'IEND') return false;

        at += 12 + length;
    }

    return false;
}

function blackenSplash() {
    const loader = document.getElementById('loader');
    if (!loader) return;

    loader.style.setProperty('background-color', '#000', 'important');

    const match = /url\(["']?data:image\/png;base64,([^"')]+)/
        .exec(window.getComputedStyle(loader).backgroundImage || '');
    if (!match) return;

    let recoloured = null;
    try {
        const bytes = decodeBase64(match[1]);
        if (repaintPalette(bytes, SPLASH_GROUND, [0, 0, 0])) {
            recoloured = 'url(data:image/png;base64,' + encodeBase64(bytes) + ')';
        }
    } catch (e) { }

    loader.style.setProperty('background-image', recoloured || 'none', 'important');
}

function restoreSplash() {
    const loader = document.getElementById('loader');
    if (!loader) return;
    loader.style.removeProperty('background-color');
    loader.style.removeProperty('background-image');
}

function schedule() {
    if (pending) return;
    pending = setTimeout(() => {
        pending = null;
        if (configRead('enableOledTheme')) rewriteSheets();
    }, 100);
}

// The head alone: `subtree` would wake on every tile the client builds.
function watchForStylesheets() {
    if (observer || typeof MutationObserver !== 'function') return;

    observer = new MutationObserver((records) => {
        for (let i = 0; i < records.length; i++) {
            const added = records[i].addedNodes;
            for (let j = 0; j < added.length; j++) {
                const node = added[j];
                if (node === ground) continue;
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

    ground = document.createElement('style');
    ground.textContent = GROUND_CSS;
    document.head.appendChild(ground);

    blackenSplash();
    rewriteSheets();
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

    for (let i = changed.length - 1; i >= 0; i--) {
        const entry = changed[i];
        entry[0].setProperty(entry[1], entry[2], entry[3]);
    }
    changed.length = 0;
    scanned.length = 0;

    if (ground.parentNode) ground.parentNode.removeChild(ground);
    ground = null;

    restoreSplash();
}

// This module is evaluated near the top of the import chain, so anything it throws takes
// the ad blocking with it.
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
