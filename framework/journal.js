// The page's side of /__tube/log: what the framework catches goes to the console and the service.

// Relative: every route serves the page through the service.
const ROUTE = '/__tube/journal';
const MOST_SENT = 100;
const LONGEST = 500;

const state = { sent: Object.create(null), count: 0 };

const describe = (failure) => {
    if (failure === undefined || failure === null) return String(failure);
    if (failure.stack) return String(failure.stack).split('\n').slice(0, 3).join(' | ');
    if (failure.message) return String(failure.message);

    return String(failure);
};

// Each distinct line once, so a failing tick cannot flood the log.
const send = (text) => {
    const cut = String(text).slice(0, LONGEST);
    if (state.sent[cut] || state.count >= MOST_SENT) return;

    state.sent[cut] = true;
    state.count += 1;

    try {
        if (window.Image) (new window.Image()).src = `${ROUTE}?m=${encodeURIComponent(cut)}`;
    } catch (e) { /* the journal must never be a reason to fail */ }
};

const line = (facility, message, failure) => `${facility}: ${message}${failure === undefined ? '' : ` - ${describe(failure)}`}`;

const report = (facility, message, failure) => {
    if (failure === undefined) console.error(`[${facility}] ${message}`);
    else console.error(`[${facility}] ${message}`, failure);

    send(line(facility, message, failure));
};

const warn = (facility, message) => {
    console.warn(`[${facility}] ${message}`);
    send(line(facility, message));
};

export { report, warn, send, line, describe };
