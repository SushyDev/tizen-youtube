'use strict';

const port = (name, fallback) => Number(process.env[name]) || fallback;

module.exports = {
    // config.xml hard-codes PROXY in its --proxy switch, and npm run package fails if the two disagree.
    PROXY: port('TUBE_PROXY_PORT', 8099),
    DEV: port('TUBE_DEV_PORT', 8097)
};
