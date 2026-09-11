// Just enough PNG to make one splash image transparent, or repaint its background.

function buildCrcTable() {
    const step = (c) => ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
    const entry = (n) => Array.from({ length: 8 }).reduce(step, n);

    return Int32Array.from({ length: 256 }, (_, n) => entry(n));
}

const crcTable = buildCrcTable();

export function crc32(bytes, from, to) {
    const c = bytes.subarray(from, to).reduce((crc, byte) => crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8), -1);

    return (c ^ -1) >>> 0;
}

export const readUint32 = (bytes, at) => (
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
);

export function writeUint32(bytes, at, value) {
    bytes[at] = (value >>> 24) & 0xff;
    bytes[at + 1] = (value >>> 16) & 0xff;
    bytes[at + 2] = (value >>> 8) & 0xff;
    bytes[at + 3] = value & 0xff;
}

export const decodeBase64 = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

const BLOCK = 4096;

export const encodeBase64 = (bytes) => btoa(
    Array.from({ length: Math.ceil(bytes.length / BLOCK) }, (_, block) => String.fromCharCode
        .apply(null, bytes.subarray(block * BLOCK, (block + 1) * BLOCK))).join('')
);

export function chunks(bytes) {
    const at = (position) => {
        if (position + 12 > bytes.length) return [];

        const length = readUint32(bytes, position);
        const type = String.fromCharCode(
            bytes[position + 4], bytes[position + 5], bytes[position + 6], bytes[position + 7]
        );

        const here = { type, at: position, length };

        return type === 'IEND' ? [here] : [here].concat(at(position + 12 + length));
    };

    return at(8);
}

export function chunk(type, data) {
    const made = new Uint8Array(12 + data.length);

    writeUint32(made, 0, data.length);
    made.set(Uint8Array.from(type, (character) => character.charCodeAt(0)), 4);
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

const COLOUR_TYPE = 25;
const PALETTED = 3;
const TRUECOLOUR = 2;

const paletteMatches = (bytes, plte, ground) => Array
    .from({ length: Math.floor(plte.length / 3) }, (_, index) => index)
    .filter((index) => {
        const at = plte.at + 8 + index * 3;
        return bytes[at] === ground[0] && bytes[at + 1] === ground[1] && bytes[at + 2] === ground[2];
    });

const alphaTable = (bytes, trns, matches) => {
    const size = matches[matches.length - 1] + 1;

    return Uint8Array.from({ length: size }, (_, index) => {
        if (matches.indexOf(index) !== -1) return 0;
        return trns && index < trns.length ? bytes[trns.at + 8 + index] : 255;
    });
};

export function transparentGround(bytes, ground) {
    const list = chunks(bytes);
    const idat = list.find((entry) => entry.type === 'IDAT');
    if (!idat) return null;

    const trns = list.find((entry) => entry.type === 'tRNS');

    const alphasFor = (colourType) => {
        if (colourType === TRUECOLOUR) {
            return new Uint8Array([0, ground[0], 0, ground[1], 0, ground[2]]);
        }

        if (colourType !== PALETTED) return null;

        const plte = list.find((entry) => entry.type === 'PLTE');
        if (!plte) return null;

        const matches = paletteMatches(bytes, plte, ground);
        return matches.length ? alphaTable(bytes, trns, matches) : null;
    };

    const alphas = alphasFor(bytes[COLOUR_TYPE]);
    if (!alphas) return null;

    return trns
        ? spliced(bytes, chunk('tRNS', alphas), trns.at, 12 + trns.length)
        : spliced(bytes, chunk('tRNS', alphas), idat.at, 0);
}

export function repaintPalette(bytes, from, to) {
    const plte = chunks(bytes).find((entry) => entry.type === 'PLTE');
    if (!plte) return null;

    const first = plte.at + 8;

    const painted = Array
        .from({ length: Math.floor(plte.length / 3) }, (_, index) => first + index * 3)
        .filter((at) => bytes[at] === from[0] && bytes[at + 1] === from[1] && bytes[at + 2] === from[2]);

    if (!painted.length) return null;

    const colours = Uint8Array.from(bytes.subarray(first, first + plte.length), (value, index) => (
        painted.indexOf(first + index - (index % 3)) === -1 ? value : to[index % 3]
    ));

    return spliced(bytes, chunk('PLTE', colours), plte.at, 12 + plte.length);
}
