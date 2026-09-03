'use strict';

const { createHash } = require('crypto');
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');
const fetch = require('node-fetch');

// Baked in at build time from tizen.config.json so the TV never depends on an env var.
// TUBE_ORIGIN still overrides, for tests and off-TV development.
const ORIGIN = process.env.TUBE_ORIGIN || '__TUBE_ORIGIN__';
const CACHE_DIR = process.env.TUBE_CACHE_DIR || '/home/owner/share/tube';
const META_PATH = join(CACHE_DIR, 'update.json');
const FETCH_TIMEOUT = 8000;
const MAX_SCRIPT_BYTES = 4 * 1024 * 1024;

// Checked in this order so a packaged install wins over running from source.
const BUNDLED_DIRS = [
    process.env.TUBE_BUNDLE_DIR,
    join(__dirname, 'assets'),
    join(__dirname, '..', 'dist', 'assets'),
    join(__dirname, '..', 'assets')
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

// One bundle, still named `modern`: latest.json describes it under `bundles.modern` and
// an app that has not updated yet looks itself up by that key, so renaming it would
// strand those sets on their shipped script forever.
const VARIANT = 'modern';

function variantFor() {
    return VARIANT;
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

// A cache written by an older app is a leftover, not an update: the package just
// installed may carry a newer script. Without this a set that ever took an update keeps
// running it through every reinstall.
function appVersion() {
    try {
        return tizen.application.getAppInfo().version;
    } catch (e) {
        return null;
    }
}

function resolve(platformVersion) {
    const variant = variantFor(platformVersion);
    const meta = readMeta();
    const cached = cachedPath(variant);
    const running = appVersion();
    const cacheIsForThisApp = !running || (meta[variant] && meta[variant].appVersion === running);

    if (meta[variant] && meta[variant].sha256 && cacheIsForThisApp && existsSync(cached)) {
        try {
            const source = readFileSync(cached);
            // Re-verify on every read: a cached file could have been truncated by a power cut
            // between write and use.
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

            meta[variant] = {
                sha256: digest,
                version: latest.version || null,
                // Which app wrote it, so a later package is never shadowed by it.
                appVersion: appVersion(),
                at: new Date().toISOString()
            };
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
