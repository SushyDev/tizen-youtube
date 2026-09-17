const BAD_FACILITY = /^(uncaught|exit|upstream|listen|unhandled rejection|route|error|previous)$/;
const BAD_TEXT = /fail|refused|denied|error|ENOTFOUND|ETIMEDOUT|ECONNRESET|EADDRINUSE|not reachable|absent/i;
const OK_TEXT = /^(trusted|issued|staged|ok:)| is reachable/;

export const toneOf = (entry) => {
    if (BAD_FACILITY.test(entry.what) || BAD_TEXT.test(entry.text)) return 'bad';
    if (entry.what === 'warning') return 'warn';
    if (entry.what === 'listening' || OK_TEXT.test(entry.text)) return 'ok';
    if (entry.what === 'started' || entry.what === 'platform') return 'note';

    return '';
};
