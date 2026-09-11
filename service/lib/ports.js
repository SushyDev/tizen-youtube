'use strict';

// The overrides exist so tests and the runtime matrix can run beside a dev service already
// holding the default.
const port = (name, fallback) => Number(process.env[name]) || fallback;

module.exports = {
    // config.xml hard-codes PROXY in its --proxy switch, so change both together.
    PROXY: port('TUBE_PROXY_PORT', 8099),
    DEV: port('TUBE_DEV_PORT', 8097)
};
