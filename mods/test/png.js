import { chunk, chunks, crc32, decodeBase64, encodeBase64, readUint32, repaintPalette, transparentGround, writeUint32 } from '../utils/png.js';

const results = [];

const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
};

// atob/btoa are browser globals; the codec only needs them for the data URL.
global.atob = (text) => Buffer.from(text, 'base64').toString('binary');
global.btoa = (binary) => Buffer.from(binary, 'binary').toString('base64');

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// colourType 3 is paletted, which is what the splash is.
const ihdr = (colourType) => {
    const data = new Uint8Array(13);
    writeUint32(data, 0, 4);
    writeUint32(data, 4, 4);
    data[8] = 8;
    data[9] = colourType;

    return chunk('IHDR', data);
};

const png = (colourType, palette) => {
    const parts = [
        Uint8Array.from(SIGNATURE),
        ihdr(colourType),
        palette ? chunk('PLTE', Uint8Array.from(palette)) : null,
        chunk('IDAT', Uint8Array.from([1, 2, 3])),
        chunk('IEND', new Uint8Array(0))
    ].filter(Boolean);

    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);

    parts.reduce((at, part) => { out.set(part, at); return at + part.length; }, 0);

    return out;
};

const GROUND = [40, 40, 40];
const paletted = png(3, [...GROUND, 1, 2, 3, ...GROUND]);

check('the chunk table is read in order',
    chunks(paletted).map((entry) => entry.type).join(',') === 'IHDR,PLTE,IDAT,IEND',
    chunks(paletted).map((entry) => entry.type).join(','));

check('a chunk carries a CRC the reader agrees with', (() => {
    const plte = chunks(paletted).find((entry) => entry.type === 'PLTE');
    const stored = readUint32(paletted, plte.at + 8 + plte.length);

    return stored === crc32(paletted, plte.at + 4, plte.at + 8 + plte.length);
})(), 'the CRC did not verify');

check('base64 survives a round trip',
    encodeBase64(decodeBase64(encodeBase64(paletted))) === encodeBase64(paletted));

{
    const bytes = png(3, [...GROUND, 1, 2, 3, ...GROUND]);
    const painted = repaintPalette(bytes, GROUND, [0, 0, 0]);
    const plte = chunks(bytes).find((entry) => entry.type === 'PLTE');
    const first = plte.at + 8;

    // Three entries of three bytes: the first and the third are the ground colour.
    check('every palette entry of that colour is repainted', painted
        && bytes[first] === 0 && bytes[first + 1] === 0 && bytes[first + 2] === 0
        && bytes[first + 3] === 1 && bytes[first + 4] === 2 && bytes[first + 5] === 3
        && bytes[first + 6] === 0 && bytes[first + 7] === 0 && bytes[first + 8] === 0,
        Array.from(bytes.subarray(first, first + 9)).join(','));

    check('the palette CRC is rewritten to match',
        readUint32(bytes, first + plte.length) === crc32(bytes, plte.at + 4, first + plte.length),
        'the CRC was left stale');

    check('a colour that is not there repaints nothing',
        repaintPalette(png(3, [9, 9, 9]), GROUND, [0, 0, 0]) === false);
}

{
    const made = transparentGround(png(3, [...GROUND, 1, 2, 3]), GROUND);
    const trns = made && chunks(made).find((entry) => entry.type === 'tRNS');

    check('a tRNS chunk is added for a paletted image', !!trns, 'no tRNS chunk');
    check('the matching palette entry becomes transparent',
        !!trns && made[trns.at + 8] === 0, trns ? String(made[trns.at + 8]) : '-');
    check('the tRNS chunk carries a valid CRC',
        !!trns && readUint32(made, trns.at + 8 + trns.length) === crc32(made, trns.at + 4, trns.at + 8 + trns.length),
        'bad CRC');
    check('the image is still readable afterwards',
        !!made && chunks(made).map((e) => e.type).join(',') === 'IHDR,PLTE,tRNS,IDAT,IEND',
        made ? chunks(made).map((e) => e.type).join(',') : '-');
}

check('a truecolour image gets a six-byte tRNS', (() => {
    const made = transparentGround(png(2, null), GROUND);
    const trns = made && chunks(made).find((entry) => entry.type === 'tRNS');

    return !!trns && trns.length === 6;
})(), 'no six-byte tRNS');

check('a colour type it cannot handle is refused',
    transparentGround(png(6, null), GROUND) === null);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
