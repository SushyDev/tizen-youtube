'use strict';

// Each runs in the page from its own source, so it reaches nothing outside itself.
const report = (page, to) => {
    const send = (message) => {
        (new page.Image()).src = `${to}/__tube/journal?m=${encodeURIComponent(message)}`;
    };
    const reasonOf = (reason) => String((reason && (reason.stack || reason.message)) || reason);

    page.__tubeFetch = page.fetch;
    page.onerror = (message, source, line, column) => send(`${message} @ ${source}:${line}:${column}`);
    page.addEventListener('unhandledrejection', (event) => send(`rejection: ${reasonOf(event && event.reason)}`));
};

// A changed fetch is proof the userscript ran, and the timestamp keeps each line distinct.
const booted = (page, to) => {
    const ran = page.fetch !== page.__tubeFetch ? 'fetch patched by the userscript' : 'fetch untouched';
    const at = new Date().toISOString().slice(11, 19);

    (new page.Image()).src = `${to}/__tube/journal?m=${encodeURIComponent(`booted ${at}: ${ran}`)}`;
};

const inPage = (name, run, origin) => `const ${name} = ${run.toString()};${name}(window, ${JSON.stringify(origin)});`;

const reporter = (origin) => inPage('__tubeReport', report, origin);
const bootBeacon = (origin) => inPage('__tubeBooted', booted, origin);

module.exports = { reporter, bootBeacon };
