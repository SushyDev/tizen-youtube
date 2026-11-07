'use strict';

// Replaced at build time; `off` means no support bot is configured.
const BUILD_SUPPORT_URL = '__TUBE_SUPPORT_URL__';

const baked = BUILD_SUPPORT_URL.indexOf('TUBE_SUPPORT_URL') === -1 && BUILD_SUPPORT_URL !== 'off' ? BUILD_SUPPORT_URL : '';

const SUPPORT_URL = process.env.TUBE_SUPPORT_URL === undefined ? baked : process.env.TUBE_SUPPORT_URL;

module.exports = { SUPPORT_URL };
