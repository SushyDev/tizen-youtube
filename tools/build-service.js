'use strict';

const { execFileSync } = require('child_process');
const { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } = require('fs');
const { basename, join } = require('path');
const { randomBytes } = require('crypto');

const { load, gitStamp } = require('./config.js');
const { injectTokens } = require('./inject.js');
const paths = require('./paths.js');

const config = load();
const legacy = process.env.TUBE_TARGET === 'legacy';
const root = join(__dirname, '..', 'service');
const outDir = join(__dirname, '..', legacy ? paths.SERVICE_DIST_LEGACY : paths.SERVICE_DIST);
const bundle = join(outDir, 'index.js');
const assetsDir = join(outDir, 'assets');

const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });

const kb = (bytes) => `${Math.round(bytes / 1024)}kB`;

// Outside Vite, whose node12 pass re-prints ES2015 over it.
const lowerToEs5 = (code) => require('@babel/core').transformSync(code, {
    babelrc: false,
    configFile: false,
    sourceType: 'script',
    compact: false,
    presets: [['@babel/preset-env', { targets: { node: '4.4.3' }, forceAllTransforms: true }]]
}).code;

// Vite empties dist/, so the userscript has to be embedded after it and not before.
console.log(`[1/4] bundling for ${legacy ? 'node 4.4.3, with core-js, lowered to ES5' : 'node 12'}`);
run('npx', ['vite', 'build']);

const built = readFileSync(bundle, 'utf8');
const source = legacy ? lowerToEs5(built) : built;

console.log('[2/4] stamping the patch and the dev token');
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
    { __TUBE_STAMP__: stamp },
    dev ? {
        __TUBE_DEV_TOKEN__: devToken,
        __TUBE_CHII__: chii,
        __TUBE_START_DELAY__: String(Number(process.env.TUBE_START_DELAY) || 0)
    } : {}
);

const stamped = injectTokens(source, tokens).code;

writeFileSync(bundle, stamped);
console.log(`      patch: ${stamp}${dev ? ' (dev build)' : ''}`);
if (dev && chii !== 'off') console.log(`      inspector: chii at ${chii}`);
console.log(`      ${basename(outDir)}/index.js  ${kb(Buffer.byteLength(stamped))}`);

console.log('[3/4] embedding the userscript and the boot screen');

// The service serves them from the widget itself.
const embed = (shipped) => {
    const from = join(__dirname, '..', shipped);

    if (!existsSync(from)) {
        console.error(`      MISSING ${from} — run npm run build`);
        process.exit(1);
    }

    copyFileSync(from, join(assetsDir, basename(from)));
    console.log(`      ${basename(outDir)}/assets/${basename(from)}  ${kb(readFileSync(from).length)}`);
};

mkdirSync(assetsDir, { recursive: true });
[paths.BUNDLE, paths.BOOT_BUNDLE].forEach(embed);

console.log('[4/4] verifying the floor');
run('node', [join(__dirname, 'check-output.js'), bundle, legacy ? 'node4' : 'node12']);
