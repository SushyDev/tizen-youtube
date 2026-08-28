'use strict';

// Keeps the version in sync across every file that carries one.
//
//   npm run version              show current state
//   npm run version -- --check   fail if anything has drifted (used by CI)
//   npm run version -- 1.2.3     set everywhere
//
// tizen.config.json is the source of truth; everything else follows it.

const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const ui = require('./ui.js');
const { ROOT, CONFIG_PATH } = require('./config.js');

const PACKAGE_FILES = [
    'package.json',
    'mods/package.json',
    'service/package.json',
    'ui/package.json'
];

// config.xml carries three unrelated version attributes: the XML declaration,
// the widget version, and required_version. Only the widget's may be touched,
// so the match is anchored to the <widget> element's own line.
const WIDGET_FILES = ['config.xml'];
const WIDGET_LINE = /^(\s*<widget\b[^>]*?\bversion=")([^"]*)(")/m;

function readPackageVersion(relative) {
    return JSON.parse(readFileSync(join(ROOT, relative), 'utf8')).version;
}

function writePackageVersion(relative, version) {
    const path = join(ROOT, relative);
    const raw = readFileSync(path, 'utf8');
    // Rewrite the field textually to preserve formatting and key order.
    const updated = raw.replace(/("version"\s*:\s*")([^"]*)(")/, `$1${version}$3`);
    writeFileSync(path, updated);
}

function readWidgetVersion(relative) {
    const match = readFileSync(join(ROOT, relative), 'utf8').match(WIDGET_LINE);
    return match ? match[2] : null;
}

function writeWidgetVersion(relative, version) {
    const path = join(ROOT, relative);
    const raw = readFileSync(path, 'utf8');
    if (!WIDGET_LINE.test(raw)) {
        throw new Error(`${relative} has no <widget ... version="..."> attribute.`);
    }
    writeFileSync(path, raw.replace(WIDGET_LINE, `$1${version}$3`));
}

function currentState() {
    const source = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')).version;
    const entries = [];

    PACKAGE_FILES.forEach((f) => entries.push({ file: f, version: readPackageVersion(f) }));
    WIDGET_FILES.forEach((f) => entries.push({ file: f, version: readWidgetVersion(f) }));

    return { source, entries };
}

function apply(version) {
    PACKAGE_FILES.forEach((f) => writePackageVersion(f, version));
    WIDGET_FILES.forEach((f) => writeWidgetVersion(f, version));
}

function main() {
    const args = process.argv.slice(2);
    const check = args.indexOf('--check') !== -1;
    const requested = args.filter((a) => /^\d+\.\d+\.\d+$/.test(a))[0];

    if (requested) {
        const raw = readFileSync(CONFIG_PATH, 'utf8');
        writeFileSync(CONFIG_PATH, raw.replace(/("version"\s*:\s*")([^"]*)(")/, `$1${requested}$3`));
        apply(requested);
        ui.heading('version', requested);
        currentState().entries.forEach((e) => ui.ok(e.file, requested));
        ui.blank();
        ui.note(`Set everywhere to ${requested}.`);
        ui.blank();
        return;
    }

    const state = currentState();
    const drifted = state.entries.filter((e) => e.version !== state.source);

    ui.heading('version', state.source);
    state.entries.forEach((e) => {
        if (e.version === state.source) ui.ok(e.file, e.version);
        else ui.fail(e.file, `${e.version} — expected ${state.source}`);
    });
    ui.blank();

    if (!drifted.length) {
        ui.note('Everything is in sync.');
        ui.blank();
        return;
    }

    if (check) {
        ui.note(`${drifted.length} file${drifted.length === 1 ? '' : 's'} out of sync. Run: npm run version -- ${state.source}`);
        ui.blank();
        process.exit(1);
    }

    apply(state.source);
    ui.note(`Synced ${drifted.length} file${drifted.length === 1 ? '' : 's'} to ${state.source}.`);
    ui.blank();
}

try {
    main();
} catch (err) {
    ui.crash(err);
}
