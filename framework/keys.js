// Routes remote key codes to registered handlers through three capturing listeners.

const TYPES = ['keydown', 'keypress', 'keyup'];

const byCode = Object.create(null);
const state = { listening: false };

const dispatch = (event) => {
    const bucket = byCode[event.keyCode];
    if (!bucket || !bucket.length) return;

    // reduce rather than some(): every handler that asked for this code is told, and any one of
    // them may ask for the key to stop here. some() would skip the rest after the first true.
    const swallow = bucket.reduce((stop, entry) => {
        try {
            return entry.handle(event) === true || stop;
        } catch (failure) {
            console.error(`[key:${entry.name}] failed:`, failure);
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
