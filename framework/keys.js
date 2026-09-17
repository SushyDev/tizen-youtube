import { report } from './journal.js';

const TYPES = ['keydown', 'keypress', 'keyup'];

const byCode = Object.create(null);
const state = { listening: false };

const dispatch = (event) => {
    const bucket = byCode[event.keyCode];
    if (!bucket || !bucket.length) return;

    // reduce, not some(): every handler is told even after one has asked to swallow the key.
    const swallow = bucket.reduce((stop, entry) => {
        try {
            return entry.handle(event) === true || stop;
        } catch (failure) {
            report(`key:${entry.name}`, 'failed', failure);
            return stop;
        }
    }, false);

    if (!swallow) return;

    event.preventDefault();
    event.stopPropagation();
};

const listen = () => {
    if (state.listening) return;
    state.listening = true;

    TYPES.forEach((type) => document.addEventListener(type, dispatch, true));
};

const onKey = (name, keyCodes, handle) => {
    listen();

    const entry = { name, handle };
    keyCodes.forEach((code) => {
        byCode[code] = (byCode[code] || []).concat([entry]);
    });

    return () => keyCodes.forEach((code) => {
        byCode[code] = (byCode[code] || []).filter((held) => held !== entry);
    });
};

export { onKey };
