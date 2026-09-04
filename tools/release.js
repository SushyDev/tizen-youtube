'use strict';

const { createHash } = require('crypto');
const { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } = require('fs');
const { join } = require('path');

const ui = require('./ui.js');
const { load, ROOT } = require('./config.js');

let config;
try {
    config = load({ requireReal: true });
} catch (err) {
    ui.crash(err);
}

const distDir = join(ROOT, 'dist');
const assetsDir = join(ROOT, 'assets');

const outDir = join(ROOT, 'release', 'origin');

const version = config.version;
const VARIANTS = ['modern', 'legacy'];

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function ensure(dir) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function friendly(message) {
    return Object.assign(new Error(message), { isFriendly: true });
}

function bundlePath(variant) {
    return join(distDir, `userScript.${variant}.js`);
}

async function preflight() {
    let published;

    try {
        const res = await fetch(`${config.origin}/latest.json`, {
            signal: AbortSignal.timeout(8000)
        });
        if (res.status === 404) return;
        if (!res.ok) throw new Error(`origin returned ${res.status}`);
        published = await res.json();
    } catch (err) {
        ui.warn(`Could not read ${config.origin}/latest.json (${err.message}).`);
        ui.warn('Skipping the duplicate-version check — make sure this version is new.');
        ui.blank();
        return;
    }

    if (!published || published.version !== version) return;

    const changed = VARIANTS.filter((variant) => {
        const already = published.bundles && published.bundles[variant];
        const file = bundlePath(variant);
        if (!already || !existsSync(file)) return false;
        return sha256(readFileSync(file)) !== already.sha256;
    });

    if (changed.length) {
        throw friendly(
            `Version ${version} is already published, with different content ` +
            `(${changed.join(', ')}).\n\n` +
            `  Versioned paths are cached as immutable, so republishing ${version}\n` +
            '  would leave every TV permanently stuck on the old bundle.\n\n' +
            '  Bump the version first:  npm run version:set <next>'
        );
    }

    ui.warn(`Version ${version} is already published with identical content; restaging anyway.`);
    ui.blank();
}

function stage() {
    rmSync(outDir, { recursive: true, force: true });
    const versionDir = join(outDir, version);
    ensure(versionDir);

    const bundles = {};
    VARIANTS.forEach((variant) => {
        const file = bundlePath(variant);
        if (!existsSync(file)) {
            throw friendly(`Missing ${file}\n  Run: npm run build`);
        }

        const buffer = readFileSync(file);
        const name = `userScript.${variant}.js`;
        copyFileSync(file, join(versionDir, name));

        bundles[variant] = {
            path: `${version}/${name}`,
            sha256: sha256(buffer),
            bytes: buffer.length
        };
        ui.ok(variant, `${ui.bytes(buffer.length)} · ${bundles[variant].sha256.slice(0, 16)}`);
    });

    const namesFile = join(assetsDir, 'language-names.json');
    if (existsSync(namesFile)) {
        copyFileSync(namesFile, join(versionDir, 'language-names.json'));
        ui.ok('language names', ui.bytes(readFileSync(namesFile).length));
    }

    const manifest = {
        version,
        origin: config.origin,
        released: new Date().toISOString(),
        bundles
    };
    writeFileSync(join(outDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    ui.ok('latest.json', `advertises ${version}`);
}

async function main() {
    ui.heading('release', `v${version}`);
    ui.info('origin', config.origin);
    ui.blank();

    await preflight();
    stage();

    ui.blank();
    ui.note(`Staged release/origin/ — upload its contents to ${config.origin}`);
    ui.note(ui.style.dim(`  /${version}/*      Cache-Control: public, max-age=31536000, immutable`));
    ui.note(ui.style.dim('  /latest.json     Cache-Control: public, max-age=60'));
    ui.blank();
}

main().catch((err) => ui.crash(err));
