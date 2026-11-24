'use strict';

// The Tizen 10 service runtime can evaluate the entry without Node's CommonJS wrapper.
// Standard Node already supplies these variables, so this runs only in the embedded runtime.
if (typeof __dirname === 'undefined') {
    const fs = require('fs');
    const path = require('path');
    const cwd = process.cwd();
    const entry = process.argv[1] && path.dirname(path.resolve(process.argv[1]));
    const locations = [entry, cwd, path.join(cwd, 'service', 'dist')].filter(Boolean);

    global.__dirname = locations.find((dir) => fs.existsSync(path.join(dir, 'assets', 'bootScreen.js'))) || cwd;
}
if (typeof __filename === 'undefined') global.__filename = require('path').join(__dirname, 'index.js');
if (typeof module === 'undefined') global.module = { exports: {} };
