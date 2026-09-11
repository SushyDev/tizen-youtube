'use strict';

// Checks what is inside the packaged .wgt, and with --release fails on any dev-only surface in it.

const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const JSZip = require('jszip');

const ui = require('./report.js');
const paths = require('./paths.js');
const { ROOT, load } = require('./config.js');
const { assertNoTokens } = require('./inject.js');

const RELEASE = process.argv.includes('--release');

// The userscript is evaluated on every launch, so a jump past this ceiling is a regression.
const MOST_BYTES = 400 * 1024;

// Patterns, not substrings, so a bundled es-errors/eval.js is not taken for the eval route.
const DEV_SURFACES = [
    { what: 'the eval endpoint', marker: /["']\/eval["']/ },
    { what: 'the dev bridge token', marker: /x-tube-token/ },
    { what: 'the dev routes', marker: /\/__tube\/dev\// },
    { what: 'the remote inspector', marker: /\/__tube\/chii\// }
];

const REQUIRED = ['config.xml', 'icon.png', 'index.html', 'service/dist/index.js'];

const unless = (ok, message) => (ok ? [] : [message]);

const tokenFailures = (code, where) => {
    try {
        assertNoTokens(code, where);
        return [];
    } catch (error) {
        return [error.message.split('\n')[0]];
    }
};

const manifestFailures = (config, ports) => [].concat(
    unless(/nativeID/.test(config), 'config.xml no longer claims a container slot'),
    unless(/multitasking\.support"\s+value="true"/.test(config),
        'multitasking.support is not true, so the app is killed on focus loss rather than hidden'),
    unless(!/use\.game\.mode"\s+value="true"/.test(config),
        'use.game.mode is on, which leaves the video element at networkState 0'),
    unless(config.indexOf(`--proxy=http://127.0.0.2:${ports.proxy}`) !== -1,
        `config.xml does not launch the container at the proxy port ${ports.proxy}`)
);

const audit = async () => {
    const wgt = join(ROOT, paths.WGT);
    if (!existsSync(wgt)) {
        throw Object.assign(new Error(`No widget at ${paths.WGT}\n  Run: npm run package`),
            { isFriendly: true });
    }

    const zip = await JSZip.loadAsync(readFileSync(wgt));
    const named = Object.keys(zip.files).filter((name) => !zip.files[name].dir);

    const service = named.indexOf('service/dist/index.js') !== -1
        ? await zip.file('service/dist/index.js').async('string')
        : '';

    const userScript = named.find((name) => /userScript[^/]*\.js$/.test(name));
    const bundle = userScript ? await zip.file(userScript).async('string') : '';

    const config = named.indexOf('config.xml') !== -1
        ? await zip.file('config.xml').async('string')
        : null;

    const present = DEV_SURFACES.filter((surface) => surface.marker.test(service));
    const size = Buffer.byteLength(bundle);

    const failures = [].concat(
        REQUIRED.filter((name) => named.indexOf(name) === -1)
            .map((name) => `${name} is missing from the widget`),
        // Tizen resolves <content src> and <icon src> against the archive root, and cobalt.js reads
        // ../../config.xml from service/dist at runtime.
        unless(named.indexOf('app/config.xml') === -1,
            'config.xml is filed under app/ rather than at the archive root'),
        unless(!!userScript, 'no userscript asset is packaged'),
        tokenFailures(service, 'the service bundle'),
        tokenFailures(bundle, 'the userscript'),
        RELEASE ? present.map((surface) => `${surface.what} is in the shipped service bundle`) : [],
        unless(size <= MOST_BYTES,
            `the userscript is ${ui.bytes(size)}, over the ${ui.bytes(MOST_BYTES)} budget`),
        config === null ? [] : manifestFailures(config, load().ports)
    );

    const notes = RELEASE ? [] : present.map((surface) => `carries ${surface.what}`);

    return { named, size, failures, notes };
};

const main = async () => {
    ui.heading(RELEASE ? 'audit (release)' : 'audit');

    const { named, size, failures, notes } = await audit();

    if (failures.length) {
        failures.forEach((message) => ui.fail('widget', message));
        ui.blank();
        ui.note(`${failures.length} problem${failures.length === 1 ? '' : 's'} in the widget.`);
        process.exit(1);
    }

    ui.ok('widget', `${named.length} entries · userscript ${ui.bytes(size)}`);
    notes.forEach((note) => ui.warn(note));
    ui.blank();
    ui.note(RELEASE ? 'Nothing dev-only is in it.' : 'Contents are as expected.');
};

main().catch((error) => ui.crash(error));
