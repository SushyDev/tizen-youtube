'use strict';

const { existsSync, readFileSync, statSync } = require('fs');
const { join } = require('path');

const USER_SCRIPT = 'userScript.js';
const BOOT_PAGE = 'bootScreen.js';

// The widget's copies first; off the set, the build or the source tree.
const PLACES = [
    process.env.TUBE_BUNDLE_DIR,
    join(__dirname, 'assets'),
    join(__dirname, '..', 'dist', 'assets'),
    join(__dirname, '..', 'assets')
].filter(Boolean);

const locate = (name) => PLACES.map((place) => join(place, name)).find((file) => existsSync(file)) || null;

const missing = (name) => `no ${name} among the service's assets`;

const read = (name) => {
    const found = locate(name);
    if (!found) throw new Error(missing(name));

    return readFileSync(found, 'utf8');
};

const sized = (name) => {
    const found = locate(name);

    return found ? { bytes: statSync(found).size } : { error: missing(name) };
};

module.exports = { USER_SCRIPT, BOOT_PAGE, read, sized };
