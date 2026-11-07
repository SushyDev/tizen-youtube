import { drawQr } from './qrView.js';

const byId = (id) => document.getElementById(id);

const shown = { key: '', qr: null };

const text = (id, value) => {
    const node = byId(id);
    if (node) node.textContent = value || '';
};

const list = (id, steps) => {
    const node = byId(id);
    if (!node) return;

    Array.from(node.childNodes).forEach((kid) => node.removeChild(kid));

    (steps || []).forEach((step, index) => {
        const line = document.createElement('div');
        line.className = 'step';
        line.textContent = `${index + 1}. ${step}`;
        node.appendChild(line);
    });
};

// Redrawn only when something on it changed, because the QR alone is hundreds of nodes.
export const showCard = (card) => {
    const key = JSON.stringify(card);
    if (key === shown.key) return;
    shown.key = key;

    const frame = byId('card');
    if (frame) frame.className = `tone-${card.tone || 'calm'}`;

    text('version', card.version);
    text('state', card.head);
    text('detail', card.detail);
    list('steps', card.steps);

    const aside = card.aside || {};
    text('aside-label', aside.label);
    text('aside-code', aside.code);
    text('aside-url', aside.shownUrl);

    const qr = byId('qr');
    if (qr && aside.qr !== shown.qr) {
        shown.qr = aside.qr || null;
        drawQr(qr, aside.qr);
    }
};
