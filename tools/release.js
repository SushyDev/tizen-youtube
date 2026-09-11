'use strict';

const { createHash } = require('crypto');
const { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } = require('fs');
const { join } = require('path');

const ui = require('./report.js');
const { load, ROOT } = require('./config.js');

// crash() exits, so this either returns a config or does not return at all.
function loadedConfig() {
    try {
        return load({ requireReal: true });
    } catch (err) {
        return ui.crash(err);
    }
}

const config = loadedConfig();

const paths = require('./paths.js');

const distDir = join(ROOT, paths.DIST);
const assetsDir = join(ROOT, 'app', 'assets');

const outDir = join(ROOT, 'release', 'origin');

const version = config.version;
const BUNDLE = 'userScript.js';
const BUNDLE_PATH = join(distDir, BUNDLE);

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function ensure(dir) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function friendly(message) {
    return Object.assign(new Error(message), { isFriendly: true });
}

// Nothing published, an origin that cannot be reached, and an origin that answers all end the
// same way here: a manifest to compare against, or nothing to compare against.
async function published() {
    try {
        const res = await fetch(`${config.origin}/latest.json`, {
            signal: AbortSignal.timeout(8000)
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`origin returned ${res.status}`);
        return await res.json();
    } catch (err) {
        ui.warn(`Could not read ${config.origin}/latest.json (${err.message}).`);
        ui.warn('Skipping the duplicate-version check — make sure this version is new.');
        ui.blank();
        return null;
    }
}

async function preflight() {
    const already = await published();

    if (!already || already.version !== version) return;

    const shipped = already.bundle;
    const changed = shipped && existsSync(BUNDLE_PATH) && sha256(readFileSync(BUNDLE_PATH)) !== shipped.sha256;

    if (changed) {
        throw friendly(
            `Version ${version} is already published, with different content.\n\n` +
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

    if (!existsSync(BUNDLE_PATH)) throw friendly(`Missing ${BUNDLE_PATH}\n  Run: npm run build`);

    const buffer = readFileSync(BUNDLE_PATH);
    copyFileSync(BUNDLE_PATH, join(versionDir, BUNDLE));

    const bundle = {
        path: `${version}/${BUNDLE}`,
        sha256: sha256(buffer),
        bytes: buffer.length
    };
    ui.ok('userscript', `${ui.bytes(buffer.length)} · ${bundle.sha256.slice(0, 16)}`);

    const namesFile = join(assetsDir, 'language-names.json');
    if (existsSync(namesFile)) {
        copyFileSync(namesFile, join(versionDir, 'language-names.json'));
        ui.ok('language names', ui.bytes(readFileSync(namesFile).length));
    }

    const manifest = {
        version,
        origin: config.origin,
        released: new Date().toISOString(),
        bundle
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
