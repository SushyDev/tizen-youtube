'use strict';

// Checks what is inside the packaged .wgt, and with --release fails on any dev-only surface in it.

const { readFileSync, existsSync } = require('fs');
const { basename, join } = require('path');
const JSZip = require('jszip');

const ui = require('./lib/report.js');
const paths = require('./lib/paths.js');
const { ROOT, load } = require('./lib/config.js');
const { assertNoTokens } = require('./lib/inject.js');

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

// A double hyphen inside a comment makes config.xml unparseable, and the television answers that
// with "Load archive info fail" long after every check here has passed.
const commentFailures = (config) => (config.match(/<!--[\s\S]*?-->/g) || [])
    .filter((comment) => comment.slice(4, -3).indexOf('--') !== -1)
    .map((comment) => `a comment in config.xml carries a double hyphen, which no XML parser accepts: `
        + `${comment.replace(/\s+/g, ' ').slice(0, 60)}…`);

const manifestFailures = (config, ports) => [].concat(
    commentFailures(config),
    unless(/nativeID/.test(config), 'config.xml no longer claims a container slot'),
    unless(/multitasking\.support"\s+value="true"/.test(config),
        'multitasking.support is not true, so the app is killed on focus loss rather than hidden'),
    unless(!/use\.game\.mode"\s+value="true"/.test(config),
        'use.game.mode is on, which leaves the video element at networkState 0'),
    // A --proxy names one fixed address, and the container cannot reach any address we can fix.
    unless(!/--proxy=/.test(config),
        'config.xml carries a --proxy switch, which no set the boot screen serves can reach'),
    unless(config.indexOf(`--base_url=file:///tube/boot.html`) !== -1
        || config.indexOf(`--base_url=http://`) !== -1,
        'config.xml does not start the container on a page we serve')
);

const audit = async (widget) => {
    const wgt = join(ROOT, widget);
    if (!existsSync(wgt)) {
        throw Object.assign(new Error(`No widget at ${widget}\n  Run: npm run package`),
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

const WIDGETS = [paths.WGT, paths.WGT_LEGACY];

const main = async () => {
    ui.heading(RELEASE ? 'audit (release)' : 'audit');

    const audited = await Promise.all(WIDGETS.map((widget) => audit(widget)
        .then((result) => Object.assign({ widget }, result))));

    const failures = audited.flatMap((result) => result.failures
        .map((message) => ({ widget: result.widget, message })));

    if (failures.length) {
        failures.forEach((failure) => ui.fail(basename(failure.widget), failure.message));
        ui.blank();
        ui.note(`${failures.length} problem${failures.length === 1 ? '' : 's'} in the widgets.`);
        process.exit(1);
    }

    audited.forEach((result) => {
        ui.ok(basename(result.widget), `${result.named.length} entries · userscript ${ui.bytes(result.size)}`);
        result.notes.forEach((note) => ui.warn(note));
    });
    ui.blank();
    ui.note(RELEASE ? 'Nothing dev-only is in them.' : 'Contents are as expected.');
};

main().catch((error) => ui.crash(error));
