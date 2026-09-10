'use strict';

// What is actually inside the widget, asked of the widget rather than of the tree it was built
// from.
//
//   node tools/audit.js [--release]
//
// Everything else in the pipeline checks source or a bundle on the way past. This opens the .wgt
// that is about to be installed, because that is the only artefact whose contents are the thing a
// viewer runs — and the dev surfaces below are the ones that must never reach one: /eval runs
// arbitrary source in the page behind a single header check, on a server bound to 0.0.0.0.
//
// Without --release a dev surface is reported and allowed, because a dev package is built and
// installed dozens of times a day on purpose. With it, one is a failure.

const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const JSZip = require('jszip');

const ui = require('./report.js');
const paths = require('./paths.js');
const { ROOT, load } = require('./config.js');
const { assertNoTokens } = require('./inject.js');

const RELEASE = process.argv.includes('--release');

// The userscript is parsed and evaluated on a television before anything is drawn, so its size is
// a cost paid on every launch. The floor is generous; it is here to catch a jump, not to shave.
const MOST_BYTES = 400 * 1024;

// Each is a dev-only route or credential, matched as it appears in the bundle — which is
// minify: false on purpose, so they survive verbatim. Patterns rather than substrings because a
// bundled dependency files its own source under node_modules/es-errors/eval.js, and a search for
// `/eval` finds that comment and calls a clean release build dirty.
const DEV_SURFACES = [
    { what: 'the eval endpoint', marker: /["']\/eval["']/ },
    { what: 'the dev bridge token', marker: /x-tube-token/ },
    { what: 'the dev routes', marker: /\/__tube\/dev\// },
    { what: 'the remote inspector', marker: /\/__tube\/chii\// }
];

const REQUIRED = ['config.xml', 'icon.png', 'index.html', 'service/dist/index.js'];

const failures = [];
const notes = [];

const fail = (message) => failures.push(message);

const check = (ok, message) => {
    if (!ok) fail(message);
    return ok;
};

const audit = async () => {
    const wgt = join(ROOT, paths.WGT);
    if (!existsSync(wgt)) {
        throw Object.assign(new Error(`No widget at ${paths.WGT}\n  Run: npm run package`),
            { isFriendly: true });
    }

    const zip = await JSZip.loadAsync(readFileSync(wgt));
    const named = Object.keys(zip.files).filter((name) => !zip.files[name].dir);

    REQUIRED.forEach((name) => check(named.indexOf(name) !== -1,
        `${name} is missing from the widget`));

    // Tizen resolves <content src> and <icon src> against the archive root, and cobalt.js reads
    // ../../config.xml from service/dist at runtime.
    check(named.indexOf('app/config.xml') === -1,
        'config.xml is filed under app/ rather than at the archive root');

    const service = named.indexOf('service/dist/index.js') !== -1
        ? await zip.file('service/dist/index.js').async('string')
        : '';

    const userScript = named.find((name) => /userScript[^/]*\.js$/.test(name));
    check(!!userScript, 'no userscript asset is packaged');

    const bundle = userScript ? await zip.file(userScript).async('string') : '';

    // Never substituted means it ships as the literal token, which reads as a working value and
    // is not one. Asked of inject.js rather than by looking for the prefix: __TUBE_ also spells a
    // runtime global the proxy sets, and a second copy of the rule is a second thing to be wrong.
    [[service, 'the service bundle'], [bundle, 'the userscript']].forEach(([code, where]) => {
        try {
            assertNoTokens(code, where);
        } catch (error) {
            fail(error.message.split('\n')[0]);
        }
    });

    const present = DEV_SURFACES.filter((surface) => surface.marker.test(service));

    present.forEach((surface) => {
        if (RELEASE) return fail(`${surface.what} is in the shipped service bundle`);
        return notes.push(`carries ${surface.what}`);
    });

    const size = Buffer.byteLength(bundle);
    check(size <= MOST_BYTES,
        `the userscript is ${ui.bytes(size)}, over the ${ui.bytes(MOST_BYTES)} budget`);

    const config = await zip.file('config.xml').async('string');
    const ports = load().ports;

    // The three the set is unforgiving about, each of which has cost a black screen or a launch
    // that starts nothing.
    check(/nativeID/.test(config), 'config.xml no longer claims a container slot');
    check(/multitasking\.support"\s+value="true"/.test(config),
        'multitasking.support is not true, so the app is killed on focus loss rather than hidden');
    check(!/use\.game\.mode"\s+value="true"/.test(config),
        'use.game.mode is on, which leaves the video element at networkState 0');
    check(config.indexOf(`--proxy=http://127.0.0.2:${ports.proxy}`) !== -1,
        `config.xml does not launch the container at the proxy port ${ports.proxy}`);

    return { named, size, bundle };
};

const main = async () => {
    ui.heading(RELEASE ? 'audit (release)' : 'audit');

    const { named, size } = await audit();

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
