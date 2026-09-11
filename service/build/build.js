'use strict';

const { execFileSync } = require('child_process');
const { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } = require('fs');
const { join } = require('path');

const { load } = require('../../tools/config.js');
const { injectTokens } = require('../../tools/inject.js');

const config = load();
const root = join(__dirname, '..');
const outDir = join(root, 'dist');
const bundle = join(outDir, 'index.js');
const assetsDir = join(outDir, 'assets');
const modsDist = join(root, '..', 'dist');

const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });

const kb = (bytes) => `${Math.round(bytes / 1024)}kB`;

// Vite empties dist/, so the userscript has to be embedded after it and not before.
console.log('[1/4] bundling for node 12');
run('npx', ['vite', 'build']);

console.log('[2/4] stamping the origin');
const stamped = injectTokens(readFileSync(bundle, 'utf8'), {
    __TUBE_ORIGIN__: config.origin
}).code;

writeFileSync(bundle, stamped);
console.log(`      origin: ${config.origin}`);
console.log(`      dist/index.js  ${kb(Buffer.byteLength(stamped))}`);

console.log('[3/4] embedding the userscript');
const userScript = join(modsDist, 'userScript.js');

if (!existsSync(userScript)) {
    console.error(`      MISSING ${userScript} — build mods first (cd mods && npm run build)`);
    console.error('      refusing to ship without it: a first launch must work offline');
    process.exit(1);
}

mkdirSync(assetsDir, { recursive: true });
copyFileSync(userScript, join(assetsDir, 'userScript.js'));
console.log(`      dist/assets/userScript.js  ${kb(readFileSync(userScript).length)}`);

console.log('[4/4] verifying the floor');
run('node', [join(root, '..', 'tools', 'check-output.js'), bundle, 'node12']);
