'use strict';

// What the service is when there is nobody watching.
//
// vite resolves ./dev/index.js here for a ship build, so the bridge, the journal, the dev routes
// and the page hooks never enter the bundle at all. That is the guarantee — not dead-code
// elimination, which cannot be relied on here because the service is deliberately built
// unminified so it can be read on a television when something has gone wrong.
//
// Every export below has to match service/dev/index.js, and be inert.

const nothing = () => undefined;

module.exports = {
    attach: nothing,
    routes: nothing,
    pageRoutes: nothing,
    pageScripts: () => '',
    spoofUserAgent: (text) => text,
    upstreamHeaders: (headers) => headers,

    // Called on the hot path of every proxied request and every tunnel, so it answers rather than
    // being absent: one call returning false, instead of a branch at each call site.
    journal: {
        wanted: () => false,
        service: nothing,
        fromPage: nothing,
        open: nothing,
        read: () => '',
        clear: nothing
    }
};
