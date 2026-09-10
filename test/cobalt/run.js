'use strict';

// The userscript in Cobalt, against real YouTube.
//
//   node test/cobalt/run.js [--image ghcr.io/…/cobalt:latest]
//
// What this is for, and the browser suite is not: the set is served `default-src 'none'`, where a
// directive the policy omits is a refusal rather than a relaxation. Chromium reads an omitted
// directive as permission, so a run there proves nothing about whether SponsorBlock can reach its
// api — and that request being refused looks exactly like the data being wrong.
//
// The page is asked through the dev bridge, the same channel doctor-tv.js uses on a television.
// Not the proxy's log: it only records requests that arrived over our own TLS, and in CI there is
// no certificate to intercept with. Not Cobalt's debugger either, since the bridge already works
// inside Cobalt and needs nothing from the engine.

const { spawn } = require('child_process');
const { join } = require('path');

const ui = require('../../tools/report.js');
const { ROOT } = require('../../tools/config.js');
const { evaluate } = require('../../tools/bridge.js');

const at = (flag, fallback) => {
    const found = process.argv.indexOf(flag);
    return found === -1 ? fallback : process.argv[found + 1];
};

const IMAGE = at('--image', process.env.TUBE_COBALT_IMAGE || 'ghcr.io/sushydev/tizen-youtube/cobalt:latest');
const PORT = Number(process.env.TUBE_COBALT_PORT) || 8299;
const DEV_PORT = Number(process.env.TUBE_DEV_PORT) || 8297;
const TOKEN = process.env.TUBE_DEV_TOKEN || 'cobalt-ci';

// What the container sends, so YouTube serves the page a set is served.
const AGENT = 'Mozilla/5.0 (LINUX; Tizen/9.0/2025.20.1034877) Cobalt/25.lts.30.1034943-gold '
    + '(unlike Gecko) v8/8.8.278.17-jit gles Evergreen-Full';

const BOOTING = 90000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const until = async (ask, left) => {
    const remaining = left === undefined ? BOOTING : left;
    if (remaining <= 0) return false;

    if (await ask().catch(() => false)) return true;

    await wait(1000);
    return until(ask, remaining - 1000);
};

const serve = () => spawn(process.execPath, ['index.js'], {
    cwd: join(ROOT, 'service'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
        TUBE_PROXY_PORT: String(PORT),
        TUBE_DEV_PORT: String(DEV_PORT),
        TUBE_DEV_TOKEN: TOKEN,
        TUBE_DEV_UA: AGENT,
        TUBE_PLATFORM_VERSION: '9.0',
        TUBE_BUNDLE_DIR: join(ROOT, 'dist'),
        TUBE_CACHE_DIR: join(ROOT, '.dev', 'cobalt-cache')
    })
});

// Loaded from the service directly rather than through --proxy: interception needs a certificate
// authority the runner does not have, and without one every host is tunnelled and nothing is
// dressed. --network host so the container reaches the service on the runner's own loopback.
const run = (said) => {
    const cobalt = spawn('docker', [
        'run', '--rm', '--network', 'host', IMAGE,
        '/cobalt/cobalt',
        `--url=http://127.0.0.1:${PORT}/tv`,
        '--disable_splash_screen_on_reloads'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    cobalt.stdout.on('data', (chunk) => said.push(String(chunk)));
    cobalt.stderr.on('data', (chunk) => said.push(String(chunk)));

    return cobalt;
};

// A bridge that has heard from the page recently, which is the page having booted far enough to
// run our bundle.
const reporting = () => fetch(`http://127.0.0.1:${DEV_PORT}/stats`)
    .then((answer) => answer.json())
    .then((stats) => stats.ok && stats.stale === false);

// Each answers with the empty string when it holds, and with what is wrong when it does not.
const IN_THE_PAGE = `(async function () {
    var checks = {};
    var yttv = window._yttv || {};
    var switches = (window.tectonicConfig || {}).featureSwitches;

    checks['our bundle was injected'] = typeof window.__TUBE_NATIVE_PROXY_PATCHES__ !== 'undefined'
        ? '' : 'the page was not dressed by the proxy';
    checks['kabuki loaded its modules'] = Object.keys(yttv).length > 500
        ? '' : 'window._yttv holds ' + Object.keys(yttv).length + ' entries';
    checks['the feature switches arrived'] = switches ? '' : 'no tectonicConfig.featureSwitches';
    checks['there is no History API'] = window.history.replaceState === undefined
        ? '' : 'history.replaceState exists, so this is not behaving as the container does';

    // Any answer at all means the request left the page; a refusal by the content policy rejects
    // the promise before it reaches the network.
    checks['sponsorblock is reachable under the real policy'] = await fetch(
        'https://sponsor.ajay.app/api/skipSegments/aaaa?categories=%5B%22sponsor%22%5D'
    ).then(function () { return ''; }, function (error) {
        return 'refused: ' + (error && error.message || error);
    });

    return JSON.stringify(checks);
}())`;

const main = async () => {
    ui.heading('cobalt');
    ui.info('image', IMAGE);
    ui.info('page', `http://127.0.0.1:${PORT}/tv`);

    const service = serve();
    const said = [];
    const held = { cobalt: null };

    const stop = () => {
        if (held.cobalt) held.cobalt.kill();
        service.kill();
    };

    try {
        const up = await until(() => fetch(`http://127.0.0.1:${PORT}/__tube/state`).then((a) => a.ok));
        if (!up) throw Object.assign(new Error('the service never answered'), { isFriendly: true });

        held.cobalt = run(said);

        const booted = await until(reporting);
        if (!booted) {
            throw Object.assign(new Error('the page never reported through the bridge.\n'
                + `  Cobalt said:\n${said.join('').split('\n').slice(-20).join('\n')}`),
            { isFriendly: true });
        }

        const checks = JSON.parse(JSON.parse(await evaluate(IN_THE_PAGE,
            { tv: '127.0.0.1', token: TOKEN })));

        const consoleSaid = said.join('');
        const startFailure = (consoleSaid.match(/\[[^\]]+\] did not start:[^\n]*/) || [])[0];
        checks['no feature failed to start'] = startFailure || '';

        ui.blank();

        const names = Object.keys(checks);
        names.forEach((name) => (checks[name] === ''
            ? ui.ok(name, 'yes')
            : ui.fail(name, checks[name])));

        const broken = names.filter((name) => checks[name] !== '');
        ui.blank();

        if (broken.length) {
            ui.note(`${names.length - broken.length}/${names.length} — Cobalt did not agree.`);
            process.exitCode = 1;
            return;
        }

        ui.note(`${names.length}/${names.length} — the engine that ships agrees.`);
    } finally {
        stop();
    }
};

main().catch((error) => ui.crash(error));
