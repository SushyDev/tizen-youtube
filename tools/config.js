'use strict';

// What the build is: tizen.config.json, and the commit it is built from.

const { execFileSync } = require('child_process');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const CONFIG_PATH = join(ROOT, 'tizen.config.json');

const fail = (message) => {
    throw Object.assign(new Error(message), { isConfigError: true });
};

const readConfigFile = () => {
    if (!existsSync(CONFIG_PATH)) fail(`No tizen.config.json at the repository root.\n  Expected: ${CONFIG_PATH}`);

    try {
        return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
        return fail(`tizen.config.json is not valid JSON: ${e.message}`);
    }
};

const parseUrl = (value) => {
    try {
        return new URL(value);
    } catch (e) {
        return null;
    }
};

const git = (args) => {
    try {
        return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (e) {
        return null;
    }
};

// Baked in so Settings can name the commit a set is running.
const gitStamp = () => {
    const commit = git(['rev-parse', '--short=7', 'HEAD']);
    if (!commit) return { commit: 'nogit', tree: 'unknown' };

    // Untracked files count: a mod not committed yet still ends up in the bundle.
    const changes = git(['status', '--porcelain']);

    return { commit, tree: changes === null ? 'unknown' : changes === '' ? 'clean' : 'dirty' };
};

const load = () => {
    const file = readConfigFile();
    const config = { version: process.env.TUBE_VERSION || file.version, ports: file.ports };

    if (!/^\d+\.\d+\.\d+$/.test(String(config.version || ''))) {
        fail(`version must be MAJOR.MINOR.PATCH, got ${JSON.stringify(config.version)}`);
    }

    return config;
};

module.exports = { load, gitStamp, parseUrl, CONFIG_PATH, ROOT };
