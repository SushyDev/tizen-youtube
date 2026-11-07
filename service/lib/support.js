'use strict';

// Replaced at build time; `off` means no support bot is configured.
const BUILD_SUPPORT_URL = '__TUBE_SUPPORT_URL__';

// A pattern rather than a comparison, which the bundler folded before the token was replaced and so shipped `off`.
const baked = /^https:\/\//.test(BUILD_SUPPORT_URL) ? BUILD_SUPPORT_URL : '';

const SUPPORT_URL = process.env.TUBE_SUPPORT_URL === undefined ? baked : process.env.TUBE_SUPPORT_URL;

module.exports = { SUPPORT_URL };
