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
    startDelay: () => 0,

    // Called on the hot path of every proxied request and tunnel, so it answers rather than being absent.
    journal: {
        wanted: () => false,
        service: nothing,
        fromPage: nothing,
        open: nothing,
        read: () => '',
        clear: nothing
    }
};
