'use strict';

// Keeps the version in sync across every file that carries one.
//
//   npm run version              show current state, and sync anything adrift
//   npm run version:check        fail if anything has drifted (used by CI)
//   npm run version:set 1.2.3    set it everywhere at once
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

// package-lock.json carries the version five times over: once at the top
// level, and once each for the root package and the three workspaces under
// "packages". Every other version in it belongs to a dependency, so this one
// is edited structurally rather than by pattern — a textual replace would
// rewrite half of npm's registry along with it.
const LOCK_FILES = ['package-lock.json'];

// config.xml carries three unrelated version attributes: the XML declaration,
// the widget version, and required_version. Only the widget's may be touched,
// so the match is anchored to the <widget> element's own line.
const VERSION = /^\d+\.\d+\.\d+$/;

const WIDGET_FILES = ['config.xml'];
const WIDGET_LINE = /^(\s*<widget\b[^>]*?\bversion=")([^"]*)(")/m;

// A workspace is keyed inside the lockfile by its directory, and the root
// package by the empty string.
function lockKeys() {
    return PACKAGE_FILES.map((f) => (f === 'package.json' ? '' : f.replace(/\/package\.json$/, '')));
}

function eachLockVersion(lock, visit) {
    if (typeof lock.version === 'string') visit(lock, 'version');
    lockKeys().forEach((key) => {
        const entry = lock.packages && lock.packages[key];
        if (entry && typeof entry.version === 'string') visit(entry, 'version');
    });
}

function readLockVersion(relative) {
    const lock = JSON.parse(readFileSync(join(ROOT, relative), 'utf8'));
    const found = [];
    eachLockVersion(lock, (holder, field) => found.push(holder[field]));
    if (!found.length) return null;
    // One line reports the whole file, so a disagreement inside it has to read
    // as one rather than hide behind whichever version happened to come first.
    return found.filter((v, i) => found.indexOf(v) === i).join(' / ');
}

function writeLockVersion(relative, version) {
    const path = join(ROOT, relative);
    const lock = JSON.parse(readFileSync(path, 'utf8'));
    eachLockVersion(lock, (holder, field) => { holder[field] = version; });
    // npm writes this file as two-space JSON with a trailing newline, so
    // writing it back that way leaves no diff beyond the versions themselves.
    writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
}

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
    LOCK_FILES.forEach((f) => entries.push({ file: f, version: readLockVersion(f) }));

    return { source, entries };
}

function apply(version) {
    PACKAGE_FILES.forEach((f) => writePackageVersion(f, version));
    WIDGET_FILES.forEach((f) => writeWidgetVersion(f, version));
    LOCK_FILES.forEach((f) => writeLockVersion(f, version));
}

function main() {
    const args = process.argv.slice(2);
    const check = args.indexOf('--check') !== -1;
    const set = args.indexOf('--set') !== -1;
    const given = args.filter((a) => a.charAt(0) !== '-');
    const requested = given.filter((a) => VERSION.test(a))[0];

    // `version:set` with nothing usable to set is a typo, and syncing the tree
    // instead would be a different job done quietly under its name.
    if (set && !requested) {
        const error = new Error(given.length
            ? `${given[0]} is not a MAJOR.MINOR.PATCH version.\n  Try:  npm run version:set 1.2.3`
            : 'No version given.\n  Usage:  npm run version:set 1.2.3');
        error.isFriendly = true;
        throw error;
    }

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
        ui.note(`${drifted.length} file${drifted.length === 1 ? '' : 's'} out of sync. Run 'npm run version' to bring ${drifted.length === 1 ? 'it' : 'them'} to ${state.source}.`);
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
