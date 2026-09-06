'use strict';

const { createHash } = require('crypto');
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');
const fetch = require('node-fetch');

const ORIGIN = process.env.TUBE_ORIGIN || '__TUBE_ORIGIN__';
const CACHE_DIR = process.env.TUBE_CACHE_DIR || '/home/owner/share/tube';
const META_PATH = join(CACHE_DIR, 'update.json');
const FETCH_TIMEOUT = 8000;
const MAX_SCRIPT_BYTES = 4 * 1024 * 1024;

const BUNDLE = 'userScript.js';

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

function bundledPath() {
    const found = BUNDLED_DIRS.map((dir) => join(dir, BUNDLE)).find(existsSync);
    return found || join(BUNDLED_DIRS[0], BUNDLE);
}

function cachedPath() {
    return join(CACHE_DIR, BUNDLE);
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
        if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
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

function resolve() {
    const meta = readMeta();
    const cached = cachedPath();
    const running = appVersion();
    const cacheIsForThisApp = !running || meta.appVersion === running;

    if (meta.sha256 && cacheIsForThisApp && existsSync(cached)) {
        try {
            const source = readFileSync(cached);
            if (sha256(source) === meta.sha256) {
                return { source: source.toString('utf8'), version: meta.version, origin: 'cache' };
            }
            console.error('Cached userscript failed its digest check; using the bundled copy.');
        } catch (e) {
            console.error(`Could not read cached userscript: ${e.message}`);
        }
    }

    const bundled = bundledPath();
    if (!existsSync(bundled)) throw new Error('No userscript is available.');

    return { source: readFileSync(bundled, 'utf8'), version: 'bundled', origin: 'bundled' };
}

function checkForUpdate() {
    return timed(
        fetch(`${ORIGIN}/latest.json`, { headers: { 'user-agent': 'tube/0.1' } })
            .then((res) => {
                if (!res.ok) throw new Error(`latest.json returned ${res.status}`);
                return res.json();
            }),
        FETCH_TIMEOUT,
        'Update check'
    ).then((latest) => {
        const entry = latest && latest.bundle;
        if (!entry || !entry.path || !entry.sha256) {
            throw new Error('latest.json did not describe a bundle.');
        }

        const meta = readMeta();
        if (meta.sha256 === entry.sha256) return false;

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
                throw new Error(`Digest mismatch — expected ${entry.sha256}, got ${digest}.`);
            }

            if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
            writeFileSync(cachedPath(), buffer);

            writeMeta({
                sha256: digest,
                version: latest.version || null,
                // Which app wrote it, so a later package is never shadowed by it.
                appVersion: appVersion(),
                at: new Date().toISOString()
            });

            console.log(`Updated the userscript to ${latest.version || digest.slice(0, 12)}.`);
            return true;
        });
    }).catch((err) => {
        console.error(`Update check failed, keeping current script: ${err.message}`);
        return false;
    });
}

module.exports = { resolve, checkForUpdate, sha256 };
