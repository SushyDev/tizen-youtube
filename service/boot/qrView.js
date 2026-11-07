import { encode } from './vendor/qr.js';

const QUIET = 4;

// Of the screen's height, so the code scans from a sofa.
const SHARE = 0.21;

const empty = (node) => Array.from(node.childNodes).forEach((kid) => node.removeChild(kid));

const block = (left, top, width, height) => {
    const piece = document.createElement('div');
    piece.className = 'm';
    piece.style.left = `${left}px`;
    piece.style.top = `${top}px`;
    piece.style.width = `${width}px`;
    piece.style.height = `${height}px`;
    return piece;
};

const rowsOf = (text) => {
    try {
        return text ? encode(text, 'M') : null;
    } catch (e) {
        return null;
    }
};

// Each run of dark modules as [from, to), so a row is a handful of divs rather than one per module.
const runsOf = (row) => row.concat([false]).reduce((held, dark, x) => {
    if (dark && held.from === -1) return { from: x, runs: held.runs };
    if (dark || held.from === -1) return held;

    return { from: -1, runs: held.runs.concat([[held.from, x]]) };
}, { from: -1, runs: [] }).runs;

// Cobalt has no canvas, so the code is drawn with positioned divs.
export const drawQr = (node, text) => {
    empty(node);

    const rows = rowsOf(text);

    if (!rows) {
        node.style.display = 'none';
        return;
    }

    const count = rows.length + QUIET * 2;
    const size = Math.max(3, Math.floor(((window.innerHeight || 1080) * SHARE) / count));

    node.style.display = 'block';
    node.style.width = `${size * count}px`;
    node.style.height = `${size * count}px`;

    rows.forEach((row, y) => runsOf(row).forEach(([from, to]) => node.appendChild(
        block((from + QUIET) * size, (y + QUIET) * size, (to - from) * size, size)
    )));
};
