// True black, for the panels that can do it.
//
// YouTube's television client paints its ground #0f0f0f. On an LCD that reads as
// black; on a self-emissive panel it is a lit grey, and every pixel of it is drawing
// power to say "nearly off". This rewrites the client's palette so the ground is
// #000000 and everything standing on it keeps the relationship it had — a surface that
// was a step above the ground stays a step above the ground, rather than becoming a
// grey slab floating in the dark.
//
// The rewrite matches on colour rather than on selector. YouTube's class names are
// per-build hashes — `.hsdF6b` is the sidebar this week and something else next month —
// but the palette underneath them is brand furniture and barely moves. Keying off the
// colour means a deploy can rename every class in the client without breaking this.

import { configRead, configChangeEmitter } from '../config.js';

// What each of YouTube's greys is for, and what it becomes.
//
// The raised values are lower than arithmetic would give. Holding each surface's
// measured contrast against the new ground would put the search field at #303030 and
// the badge at #181818, because the contrast formula adds a term for the light a room
// throws back off the screen — and an OLED showing black throws none back. What that
// term overstates is exactly how much lift a surface needs, so these were settled by
// looking at them: far enough above the ground to read as a surface, near enough that
// the black is still what the picture is made of.
const PALETTE = {
    // The ground, and the floors its gradients fall to. All of them go to the same
    // black, which is why the long fades over thumbnails end in nothing at all.
    '15,15,15': '0, 0, 0',
    '11,11,11': '0, 0, 0',
    '6,6,6': '0, 0, 0',
    '3,3,3': '0, 0, 0',
    '1,1,1': '0, 0, 0',

    // The two grounds that are on screen before the app has rendered anything: the body
    // colour, and the splash behind the wordmark.
    '28,26,26': '0, 0, 0',
    '40,40,40': '0, 0, 0',

    // Standing on the ground: a hairline raise, a surface, a control plate, and that
    // plate under the cursor.
    '24,24,24': '13, 13, 13',
    '33,33,33': '22, 22, 22',
    '55,55,55': '31, 31, 31',
    '63,63,63': '38, 38, 38',
    '87,87,87': '51, 51, 51'
};

// #aaa is YouTube's muted label, and on a control plate — the 4K badge on a tile — it
// is small text carrying the only word in the component. Quieting the plate under it
// leaves it reading as disabled, so it comes up to meet the new plate.
//
// Only where one rule paints both the plate and the label. That pairing is YouTube's
// own statement that the two belong together; #aaa on its own is the secondary text of
// the whole app, and lifting that would flatten every view count and channel name into
// the titles above them.
const MUTED_LABEL = '170,170,170';
const LIFTED_LABEL = 'rgb(200, 200, 200)';
const PLATES = ['33,33,33', '55,55,55', '63,63,63'];

// Two things the cascade cannot reach: the ground behind everything, which has to be
// black before any of YouTube's stylesheets arrive, and the placeholder every thumbnail
// carries as an inline style until its image decodes — which is what a grid of tiles
// looks like on a slow connection, and so worth the !important.
//
// That second rule matches on the colour in the attribute rather than on the element,
// because the same element draws the wordmark in the corner with no placeholder behind
// it, and painting one in would put a grey card around the logo.
const GROUND_CSS =
    'html, body { background-color: #000; }\n' +
    'ytlr-thumbnail-details[style*="rgb(33, 33, 33)"] { background-color: #161616 !important; }\n';

const SPLASH_GROUND = [40, 40, 40];

const COLOUR = /rgba?\((\d+),\s*(\d+),\s*(\d+)((?:,\s*[\d.]+)?)\)/g;

// Every declaration this changed, with what it said before. Toggling the setting off
// has to put the client back exactly as it was, and the mapping is many-to-one — seven
// of YouTube's greys become the same black — so there is nothing to invert.
const changed = [];
const scanned = [];

let ground = null;
let observer = null;
let pending = null;

/** The `r,g,b` of a plain colour value, or null for anything else. */
function key(value) {
    const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
    return match ? match[1] + ',' + match[2] + ',' + match[3] : null;
}

function remap(value) {
    // Most declarations are geometry. Checking for a colour at all is far cheaper than
    // running the pattern over every one of the twenty-odd thousand there are.
    if (value.indexOf('rgb') === -1) return value;

    return value.replace(COLOUR, (whole, r, g, b, alpha) => {
        const to = PALETTE[r + ',' + g + ',' + b];
        if (!to) return whole;
        return (alpha ? 'rgba(' : 'rgb(') + to + alpha + ')';
    });
}

function rewriteDeclarations(style) {
    // Both lists in full before anything is written: setProperty renumbers the block
    // underneath a loop that is reading it by index.
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

        // @media, @supports and nested rules all carry children. On an engine with CSS
        // nesting a plain style rule reports an empty list rather than none at all,
        // which is what the length check is for.
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
            // A cross-origin stylesheet. Nothing to read, and nothing to come back for.
            scanned.push(sheet);
            continue;
        }

        // A <link> that has been appended but not loaded reports no rules. Leaving it
        // unmarked is what brings us back to it once it has them.
        if (!rules || !rules.length) continue;

        scanned.push(sheet);
        walkRules(rules);
    }
}

/* --- the splash ------------------------------------------------------------------ */

// The screen between the boot log and the app is a <div id="loader"> with the wordmark
// baked into an opaque PNG on a #282828 ground. The stylesheet that positions it is in
// the document head from the first byte, so the rewrite above reaches the ground colour
// — but not the ground inside the image, which is 41% of its pixels and 60% of the
// screen. Left alone it is a grey slab in the middle of a black one.
//
// The image is palette-indexed, so recolouring it is three bytes in the PLTE chunk and
// a fresh CRC: no decoding, no canvas, no second image to ship. If it is ever not that
// shape, the image is dropped and the splash is simply black.

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
    // In slices: String.fromCharCode.apply with fifteen thousand arguments overflows
    // the stack on the engines this has to run on.
    for (let i = 0; i < bytes.length; i += 4096) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
    }
    return btoa(binary);
}

/** Repaints one palette entry in place. False if this is not an indexed PNG. */
function repaintPalette(bytes, from, to) {
    let at = 8;  // past the eight-byte signature

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

        // PLTE comes before the image data in every valid PNG, so either of these means
        // there is no palette to repaint.
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
    } catch (e) { /* not a PNG this can read */ }

    // Better a splash with nothing on it than a grey slab in the middle of a black
    // screen. The app is a second away either way.
    loader.style.setProperty('background-image', recoloured || 'none', 'important');
}

function restoreSplash() {
    const loader = document.getElementById('loader');
    if (!loader) return;
    loader.style.removeProperty('background-color');
    loader.style.removeProperty('background-image');
}

/* --- turning it on and off -------------------------------------------------------- */

function schedule() {
    if (pending) return;
    pending = setTimeout(() => {
        pending = null;
        if (configRead('enableOledTheme')) rewriteSheets();
    }, 100);
}

// YouTube adds its bigger stylesheets after the document has parsed, and adds more when
// a surface it has not shown before is first rendered. All of them land in the head, so
// this watches the head alone: `subtree` here would wake on every tile the client
// builds, which on a television is the one thing worth not doing.
function watchForStylesheets() {
    if (observer || typeof MutationObserver !== 'function') return;

    observer = new MutationObserver((records) => {
        for (let i = 0; i < records.length; i++) {
            const added = records[i].addedNodes;
            for (let j = 0; j < added.length; j++) {
                const node = added[j];
                if (node === ground) continue;
                if (node.nodeName !== 'STYLE' && node.nodeName !== 'LINK') continue;
                // A <link> has no rules until it loads, so the scan is worth repeating
                // when it does.
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

// This module is evaluated near the top of the import chain, so anything it throws
// takes the ad blocking with it. A theme is never worth that.
function guard(work) {
    try {
        work();
    } catch (e) {
        console.warn('The OLED theme could not be applied.', e);
    }
}

// At import rather than on a ready event: the splash is already on screen by the time
// this bundle is evaluated, and every frame it stays grey is one the setting was meant
// to prevent.
if (configRead('enableOledTheme')) guard(enable);

configChangeEmitter.addEventListener('configChange', (event) => {
    if (event.detail.key !== 'enableOledTheme') return;
    guard(event.detail.value ? enable : disable);
});
