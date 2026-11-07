import { drawQr } from './qrView.js';

const byId = (id) => document.getElementById(id);

const shown = { key: '', qr: null };

const handlers = { press: null };

// Set by the controls, so a pointer click does what OK does.
export const whenPressed = (press) => {
    handlers.press = press;
};

const text = (id, value) => {
    const node = byId(id);
    if (node) node.textContent = value || '';
};

const empty = (node) => Array.from(node.childNodes).forEach((kid) => node.removeChild(kid));

const element = (className, value) => {
    const node = document.createElement('div');
    node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
};

const fill = (id, items, make) => {
    const node = byId(id);
    if (!node) return;

    empty(node);
    (items || []).forEach((item, index) => node.appendChild(make(item, index)));
};

const checkRow = (one) => {
    const row = element(`check check-${one.state}`);
    row.appendChild(element('dot'));
    row.appendChild(element('name', one.name));
    row.appendChild(element('text', one.text));
    return row;
};

const buttonRow = (one) => {
    const node = element(['button', one.primary ? 'primary' : '', one.off ? 'off' : '', one.focus ? 'focus' : '']
        .filter(Boolean).join(' '), one.label);

    if (one.sub) node.appendChild(element('sub', one.sub));
    if (one.value) node.appendChild(element('value', one.value));
    node.onclick = () => (handlers.press && !one.off ? handlers.press(one.id) : undefined);
    return node;
};

const show = (id, visible) => {
    const node = byId(id);
    if (node) node.style.display = visible ? 'block' : 'none';
};

// Redrawn only when something on it changed, because the QR alone is hundreds of nodes.
export const showCard = (card) => {
    const key = JSON.stringify(card);
    if (key === shown.key) return;
    shown.key = key;

    show('card', card.view !== 'logs');
    show('logs', card.view === 'logs');

    const frame = byId('card');
    if (frame) frame.className = `tone-${card.tone || 'calm'}`;

    text('version', card.version);
    text('platform', card.platform);
    text('state', card.head);
    text('detail', card.detail);
    text('hint', card.hint);
    text('logs-head', card.logsHead);
    fill('checks', card.checks, checkRow);
    fill('steps', card.steps, (step, index) => element('step', `${index + 1}. ${step}`));
    fill('buttons', card.buttons, buttonRow);

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
