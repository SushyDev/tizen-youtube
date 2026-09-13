'use strict';

const { execFileSync } = require('child_process');
const { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } = require('fs');
const { join } = require('path');
const { randomBytes } = require('crypto');

const { load, gitStamp } = require('./config.js');
const { injectTokens } = require('./inject.js');

const config = load();
const root = join(__dirname, '..', 'service');
const outDir = join(root, 'dist');
const bundle = join(outDir, 'index.js');
const assetsDir = join(outDir, 'assets');
const modsDist = join(__dirname, '..', 'dist');

const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });

const kb = (bytes) => `${Math.round(bytes / 1024)}kB`;

// Vite empties dist/, so the userscript has to be embedded after it and not before.
console.log('[1/4] bundling for node 12');
run('npx', ['vite', 'build']);

console.log('[2/4] stamping the origin and the dev token');
// __TUBE_DEV_TOKEN__ lives only in the dev bridge, which a ship build resolves away — and
// injectTokens throws on a token it cannot find, so the list has to follow the build mode.
const dev = process.env.TUBE_DEV === '1';
const devToken = process.env.TUBE_DEV_TOKEN || randomBytes(8).toString('hex');

// `off` rather than empty: injectTokens refuses a blank value, and the dev code compares against
// this sentinel to decide whether a remote inspector was asked for.
const chii = process.env.TUBE_CHII || 'off';

// The Patch string Settings shows.
const { commit, tree } = gitStamp();
const stamp = `${config.version}-${commit}-${tree}`;

const tokens = Object.assign(
    { __TUBE_ORIGIN__: config.origin, __TUBE_STAMP__: stamp },
    dev ? {
        __TUBE_DEV_TOKEN__: devToken,
        __TUBE_CHII__: chii,
        __TUBE_START_DELAY__: String(Number(process.env.TUBE_START_DELAY) || 0)
    } : {}
);

const stamped = injectTokens(readFileSync(bundle, 'utf8'), tokens).code;

writeFileSync(bundle, stamped);
console.log(`      origin: ${config.origin}${dev ? ' (dev build)' : ''}`);
if (dev && chii !== 'off') console.log(`      inspector: chii at ${chii}`);
console.log(`      dist/index.js  ${kb(Buffer.byteLength(stamped))}`);

console.log('[3/4] embedding the userscript and the boot screen');

// Both ship inside the widget: a first launch must work offline.
const embed = (name) => {
    const from = join(modsDist, name);

    if (!existsSync(from)) {
        console.error(`      MISSING ${from} — build the userscript first`);
        process.exit(1);
    }

    copyFileSync(from, join(assetsDir, name));
    console.log(`      dist/assets/${name}  ${kb(readFileSync(from).length)}`);
};

mkdirSync(assetsDir, { recursive: true });
['userScript.js', 'bootScreen.js'].forEach(embed);

console.log('[4/4] verifying the floor');
run('node', [join(__dirname, 'check-output.js'), bundle, 'node12']);
