'use strict';

// Resolves the userscript to inject.
//
// The reference fetched it from jsDelivr on every launch and, when that
// failed, injected `alert("Failed to request to JSDelivr CDN.")` — so a CDN
// blip meant a broken app. Here a copy ships inside the .wgt, so the first
// launch never touches the network at all. Updates are checked in the
// background, verified by digest before they are ever trusted, and only then
// do they take precedence. The network is never on the critical path.

const { createHash } = require('crypto');
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');
const fetch = require('node-fetch');

// Baked in at build time from tizen.config.json so the TV never depends on an
// environment variable. TUBE_ORIGIN still overrides, which is how the tests
// and off-TV development point this at a local server.
const ORIGIN = process.env.TUBE_ORIGIN || '__TUBE_ORIGIN__';
// On a TV this is the app's own data directory. Overridable so tests and
// off-TV runs never touch real state.
const CACHE_DIR = process.env.TUBE_CACHE_DIR || '/home/owner/share/tube';
const META_PATH = join(CACHE_DIR, 'update.json');
const FETCH_TIMEOUT = 8000;
const MAX_SCRIPT_BYTES = 4 * 1024 * 1024;

// Bundled alongside the service by the build. In the packaged app the ncc
// bundle and its assets sit together in dist/; running from source, assets/
// is one level up. Checked in that order so the packaged layout wins.
const BUNDLED_DIRS = [
    // Development only: where `npm run dev` has rollup writing the bundles, so
    // an edit under mods/ is picked up by the next page load without a service
    // build in between. Unset everywhere else, including on a TV.
    process.env.TUBE_BUNDLE_DIR,
    join(__dirname, 'assets'),          // packaged: dist/index.js + dist/assets
    join(__dirname, '..', 'dist', 'assets'), // running from source, after a build
    join(__dirname, '..', 'assets')     // running from source, assets alongside
].filter(Boolean);

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function timed(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out.`)), ms);
        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
}

// Chrome 63 shipped in Tizen 5.5; anything older gets the polyfilled bundle.
function variantFor(platformVersion) {
    const major = Number(String(platformVersion || '').split('.')[0]);
    return isNaN(major) || major < 5 ? 'legacy' : 'modern';
}

function bundledPath(variant) {
    for (let i = 0; i < BUNDLED_DIRS.length; i++) {
        const candidate = join(BUNDLED_DIRS[i], `userScript.${variant}.js`);
        if (existsSync(candidate)) return candidate;
    }
    return join(BUNDLED_DIRS[0], `userScript.${variant}.js`);
}

function cachedPath(variant) {
    return join(CACHE_DIR, `userScript.${variant}.js`);
}

function readMeta() {
    try {
        return JSON.parse(readFileSync(META_PATH, 'utf8'));
    } catch (e) {
        return {};
    }
}

function writeMeta(meta) {
    try {
        if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR);
        writeFileSync(META_PATH, JSON.stringify(meta));
    } catch (e) {
        console.error(`Could not record update metadata: ${e.message}`);
    }
}

// Returns the script source to inject, preferring a verified cached update
// over the bundled copy. Never throws: a broken cache falls back to what
// shipped in the package.
function resolve(platformVersion) {
    const variant = variantFor(platformVersion);
    const meta = readMeta();
    const cached = cachedPath(variant);

    if (meta[variant] && meta[variant].sha256 && existsSync(cached)) {
        try {
            const source = readFileSync(cached);
            // Re-verify on every read: a cached file could have been truncated
            // by a power cut between write and use.
            if (sha256(source) === meta[variant].sha256) {
                return { source: source.toString('utf8'), variant, version: meta[variant].version, origin: 'cache' };
            }
            console.error('Cached userscript failed its digest check; using the bundled copy.');
        } catch (e) {
            console.error(`Could not read cached userscript: ${e.message}`);
        }
    }

    const bundled = bundledPath(variant);
    if (!existsSync(bundled)) {
        throw new Error(`No userscript available for variant "${variant}".`);
    }
    return { source: readFileSync(bundled, 'utf8'), variant, version: 'bundled', origin: 'bundled' };
}

// Background update check. Resolves to true only when a new, digest-verified
// script was written; every failure path resolves false and leaves the
// currently working script in place.
function checkForUpdate(platformVersion) {
    const variant = variantFor(platformVersion);

    return timed(
        fetch(`${ORIGIN}/latest.json`, { headers: { 'user-agent': 'tube/0.1' } })
            .then((res) => {
                if (!res.ok) throw new Error(`latest.json returned ${res.status}`);
                return res.json();
            }),
        FETCH_TIMEOUT,
        'Update check'
    ).then((latest) => {
        const entry = latest && latest.bundles && latest.bundles[variant];
        if (!entry || !entry.path || !entry.sha256) {
            throw new Error('latest.json did not describe this bundle.');
        }

        const meta = readMeta();
        if (meta[variant] && meta[variant].sha256 === entry.sha256) return false;

        return timed(
            fetch(`${ORIGIN}/${entry.path}`, { headers: { 'user-agent': 'tube/0.1' } })
                .then((res) => {
                    if (!res.ok) throw new Error(`Bundle download returned ${res.status}`);
                    return res.buffer();
                }),
            FETCH_TIMEOUT * 3,
            'Bundle download'
        ).then((buffer) => {
            if (buffer.length > MAX_SCRIPT_BYTES) {
                throw new Error(`Bundle is ${buffer.length} bytes, over the limit.`);
            }

            const digest = sha256(buffer);
            if (digest !== entry.sha256) {
                // The whole point of the digest: refuse to run it, keep what works.
                throw new Error(`Digest mismatch — expected ${entry.sha256}, got ${digest}.`);
            }

            if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR);
            writeFileSync(cachedPath(variant), buffer);

            meta[variant] = { sha256: digest, version: latest.version || null, at: new Date().toISOString() };
            writeMeta(meta);

            console.log(`Updated ${variant} userscript to ${latest.version || digest.slice(0, 12)}.`);
            return true;
        });
    }).catch((err) => {
        console.error(`Update check failed, keeping current script: ${err.message}`);
        return false;
    });
}

module.exports = { resolve, checkForUpdate, variantFor, sha256, ORIGIN, CACHE_DIR };
