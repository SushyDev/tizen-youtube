'use strict';

// The Patch string Settings shows, stamped at build time.
const BUILD_STAMP = '__TUBE_STAMP__';
const STAMP = BUILD_STAMP.indexOf('TUBE_STAMP') === -1 ? BUILD_STAMP : 'unstamped';

module.exports = { STAMP };
