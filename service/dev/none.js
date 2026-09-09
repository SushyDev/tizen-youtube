'use strict';

// Inert stand-in for service/dev/index.js in a ship build; every export must match it.

const nothing = () => undefined;

module.exports = {
    attach: nothing,
    routes: nothing,
    pageRoutes: nothing,
    pageScripts: () => '',
    upgradeRewrite: () => null,
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
