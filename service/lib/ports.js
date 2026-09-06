'use strict';

// PROXY is duplicated in ui/src/boot.js, which cannot require this. The overrides exist so tests
// and the runtime matrix can run beside a dev server already holding the default.
const port = (name, fallback) => Number(process.env[name]) || fallback;

module.exports = {
    PROXY: port('TUBE_PROXY_PORT', 8099),
    DEV: port('TUBE_DEV_PORT', 8097)
};
