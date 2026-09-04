'use strict';

const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const CONFIG_PATH = join(ROOT, 'tizen.config.json');

const PLACEHOLDER_HOSTS = ['cdn.example.com', 'cdn.example.invalid', 'example.com'];

function fail(message) {
    const error = new Error(message);
    error.isConfigError = true;
    throw error;
}

function readConfigFile() {
    if (!existsSync(CONFIG_PATH)) {
        fail(`No tizen.config.json at the repository root.\n  Expected: ${CONFIG_PATH}`);
    }
    try {
        return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
        fail(`tizen.config.json is not valid JSON: ${e.message}`);
    }
}

function validUrl(value, field) {
    let url;
    try {
        url = new URL(value);
    } catch (e) {
        fail(`${field} is not a valid URL: ${JSON.stringify(value)}`);
    }
    const isLoopback = ['localhost', '127.0.0.1', '::1'].indexOf(url.hostname) !== -1;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
        fail(`${field} must use https, got ${url.protocol.replace(':', '')}: ${value}`);
    }
    return url;
}

function load(options) {
    const opts = options || {};
    const file = readConfigFile();

    const config = {
        version: process.env.TUBE_VERSION || file.version,
        origin: (process.env.TUBE_ORIGIN || file.origin || '').replace(/\/+$/, '')
    };

    if (!/^\d+\.\d+\.\d+$/.test(String(config.version || ''))) {
        fail(`version must be MAJOR.MINOR.PATCH, got ${JSON.stringify(config.version)}`);
    }

    const origin = validUrl(config.origin, 'origin');

    config.placeholders = PLACEHOLDER_HOSTS.indexOf(origin.hostname) !== -1 ? ['origin'] : [];

    if (config.placeholders.length && opts.requireReal) {
        fail(
            'origin still points at a placeholder host.\n' +
            '  Edit tizen.config.json, or set TUBE_ORIGIN, before a release build.'
        );
    }

    return config;
}

module.exports = { load, CONFIG_PATH, ROOT, PLACEHOLDER_HOSTS };
