'use strict';

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

console.log('[1/5] vendoring googlevideo as CommonJS');
run('node', [join(__dirname, 'vendor.js')]);

console.log('[2/5] bundling with ncc');
run('npx', ['ncc', 'build', 'index.js', '-o', staging, '--no-source-map-register']);

console.log('[3/5] lowering the bundle to the syntax floor');
const result = babel.transformSync(readFileSync(join(staging, 'index.js'), 'utf8'), {
    configFile: join(root, 'babel.config.json'),
    sourceType: 'script',
    compact: false,
    sourceMaps: false,
    generatorOpts: { compact: false }
});

let code = result.code;

const devToken = process.env.TUBE_DEV_TOKEN || require('crypto').randomBytes(8).toString('hex');

code = injectTokens(code, { __TUBE_ORIGIN__: config.origin, __TUBE_DEV_TOKEN__: devToken }).code;
console.log(`      origin: ${config.origin}`);

if (code.indexOf('regeneratorRuntime') !== -1) {
    console.log('      prepending regeneratorRuntime');
    const runtime = readFileSync(require.resolve('regenerator-runtime/runtime.js'), 'utf8');
    code = `${runtime}\nvar regeneratorRuntime = global.regeneratorRuntime;\n${code}`;
}

if (!existsSync(outDir)) mkdirSync(outDir);
writeFileSync(join(outDir, 'index.js'), code);
console.log(`      dist/index.js  ${Math.round(Buffer.byteLength(code) / 1024)}kB`);

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

console.log('[4/5] embedding the userscript bundle');
if (!existsSync(assetsDir)) mkdirSync(assetsDir);
const bundle = join(modsDist, 'userScript.modern.js');

if (!existsSync(bundle)) {
    console.error(`      MISSING ${bundle} — build mods first (cd mods && npm run build)`);
    console.error('      refusing to ship without it: a first launch must work offline');
    process.exit(1);
}

copyFileSync(bundle, join(assetsDir, 'userScript.modern.js'));
console.log(`      dist/assets/userScript.modern.js  ${Math.round(readFileSync(bundle).length / 1024)}kB`);

console.log('[5/5] verifying the syntax floor');
run('node', [join(__dirname, 'check-syntax.js'), join(outDir, 'index.js')]);
