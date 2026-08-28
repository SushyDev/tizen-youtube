'use strict';

// Same two-stage build as Tizen Homebrew: bundle with ncc, then lower the whole
// bundle — dependencies included — so it parses on Tizen 3's Node v4.4.3.
// The userscript bundles are copied in alongside it so the app never needs
// the network to have a working script.

const { execFileSync } = require('child_process');
const { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync, readdirSync, statSync } = require('fs');
const { join } = require('path');
const babel = require('@babel/core');

const { load } = require('../../tools/config.js');
const { injectTokens } = require('../../tools/inject.js');

const config = load();
const root = join(__dirname, '..');
const staging = join(root, '.ncc');
const outDir = join(root, 'dist');
const assetsDir = join(outDir, 'assets');
const modsDist = join(root, '..', 'dist');

function run(cmd, args) {
    execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
}

console.log('[1/4] bundling with ncc');
run('npx', ['ncc', 'build', 'index.js', '-o', staging, '--no-source-map-register']);

console.log('[2/4] lowering the bundle for Node 4.4.3');
const result = babel.transformSync(readFileSync(join(staging, 'index.js'), 'utf8'), {
    configFile: join(root, 'babel.config.json'),
    // ncc emits CommonJS, and some dependencies use `await` as an ordinary
    // identifier (e.g. `Gate.prototype.await = function await(cb)`), which is
    // legal in script mode but a reserved word under Babel's default module
    // parsing. Saying so explicitly keeps those dependencies parseable.
    sourceType: 'script',
    compact: false,
    sourceMaps: false,
    generatorOpts: { compact: false }
});

let code = result.code;

// Bake the origin in so the running app needs no environment.
code = injectTokens(code, { __TUBE_ORIGIN__: config.origin }).code;
console.log(`      origin: ${config.origin}`);

if (code.indexOf('regeneratorRuntime') !== -1) {
    console.log('      prepending regeneratorRuntime');
    const runtime = readFileSync(require.resolve('regenerator-runtime/runtime.js'), 'utf8');
    code = `${runtime}\nvar regeneratorRuntime = global.regeneratorRuntime;\n${code}`;
}

if (!existsSync(outDir)) mkdirSync(outDir);
writeFileSync(join(outDir, 'index.js'), code);
console.log(`      dist/index.js  ${Math.round(Buffer.byteLength(code) / 1024)}kB`);

// ncc emits non-JS assets next to the bundle and references them as
// `__nccwpck_require__.ab + "<name>"`, which resolves against __dirname.
// peer-dial's device-desc.xml and app-desc.xml come through this way, so
// dropping them means DIAL fails with ENOENT the first time a phone tries to
// discover the TV.
function copyTree(from, to) {
    if (!existsSync(to)) mkdirSync(to);
    readdirSync(from).forEach((entry) => {
        const source = join(from, entry);
        const target = join(to, entry);
        if (statSync(source).isDirectory()) return copyTree(source, target);
        copyFileSync(source, target);
    });
}

readdirSync(staging).forEach((entry) => {
    if (entry === 'index.js') return;
    const source = join(staging, entry);
    if (statSync(source).isDirectory()) copyTree(source, join(outDir, entry));
    else copyFileSync(source, join(outDir, entry));
    console.log(`      carried ncc asset: ${entry}`);
});

rmSync(staging, { recursive: true, force: true });

console.log('[3/4] embedding the userscript bundles');
if (!existsSync(assetsDir)) mkdirSync(assetsDir);
let embedded = 0;
['modern', 'legacy'].forEach((variant) => {
    const source = join(modsDist, `userScript.${variant}.js`);
    if (!existsSync(source)) {
        console.error(`      MISSING ${source} — build mods first (cd mods && npm run build)`);
        return;
    }
    copyFileSync(source, join(assetsDir, `userScript.${variant}.js`));
    embedded++;
    console.log(`      dist/assets/userScript.${variant}.js  ${Math.round(readFileSync(source).length / 1024)}kB`);
});

if (embedded !== 2) {
    console.error('      refusing to ship without both bundles: first launch must work offline');
    process.exit(1);
}

console.log('[4/4] verifying Node 4.4.3 compatibility');
run('node', [join(__dirname, 'check-node4.js'), join(outDir, 'index.js')]);
