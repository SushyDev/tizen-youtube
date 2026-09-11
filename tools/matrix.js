'use strict';

// Runs the bundle smoke test on every Node this service has to survive.
//
//   npm run test:matrix [-- --serial] [-- 12.16.3 18.18.2]

const { execFile } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');

const ui = require('./report.js');
const { load, ROOT } = require('./config.js');

const TARGETS = [
    { node: '12.16.3', note: 'Tizen 6.5 — verified on hardware, and the floor' },
    { node: '14.21.3', note: 'unverified — margin, and the first with require("fs/promises")' },
    { node: '16.20.2', note: 'unverified — margin' },
    { node: '18.18.2', note: 'Tizen 9.0 — verified on hardware' },
    { node: '20.18.1', note: 'newer than any set seen — margin' },
    { node: '22.12.0', note: 'newer than any set seen — margin' }
];

const BASE_PORT = load().ports.matrix;

const SMOKE = join(ROOT, 'service', 'test', 'smoke.js');

const friendly = (message) => Object.assign(new Error(message), { isFriendly: true });

const run = (command, args, options) => new Promise((resolve) => {
    execFile(command, args, options || {}, (error, stdout, stderr) => {
        resolve({ ok: !error, out: `${stdout || ''}${stderr || ''}` });
    });
});

const smokeOn = (target, index) => {
    const port = BASE_PORT + index;

    return run('fnm', ['exec', `--using=${target.node}`, 'node', SMOKE], {
        cwd: ROOT,
        env: Object.assign({}, process.env, { TUBE_PROXY_PORT: String(port) })
    }).then((result) => Object.assign({ target, port }, result));
};

const report = (result) => {
    const label = `node ${result.target.node}`;

    if (result.ok) return ui.ok(label, result.target.note);

    ui.fail(label, result.target.note);
    result.out.split('\n').filter((line) => line.trim()).slice(-8)
        .forEach((line) => process.stdout.write(`      ${line}\n`));

    return undefined;
};

const main = async () => {
    const args = process.argv.slice(2);
    const serial = args.indexOf('--serial') !== -1;
    const wanted = args.filter((argument) => argument[0] !== '-');

    const targets = wanted.length
        ? TARGETS.filter((target) => wanted.some((version) => target.node.indexOf(version) === 0))
        : TARGETS;

    if (!targets.length) throw friendly(`No target matches ${wanted.join(', ')}.`);

    if (!existsSync(join(ROOT, 'service', 'dist', 'index.js'))) {
        throw friendly('No bundle to test. Run `npm run build` first.');
    }

    if (!(await run('fnm', ['--version'])).ok) {
        throw friendly(
            'fnm is not installed, and it is what switches Node versions here.\n\n'
            + '  brew install fnm      or see https://github.com/Schniz/fnm\n\n'
            + '  CI runs the same matrix with actions/setup-node, so this is a local convenience.'
        );
    }

    const installed = (await run('fnm', ['list'])).out.match(/v\d+\.\d+\.\d+/g) || [];
    const missing = targets
        .map((target) => target.node)
        .filter((version) => installed.indexOf(`v${version}`) === -1);

    if (missing.length) {
        throw friendly(
            `node ${missing.join(', ')} is not installed, so the bundle was not run on it.\n\n`
            + missing.map((version) => `  fnm install ${version}`).join('\n')
        );
    }

    ui.heading('matrix', `${targets.length} runtimes`);

    const results = serial
        ? await targets.reduce(
            (queue, target, index) => queue.then(
                (done) => smokeOn(target, index).then((result) => done.concat(result))
            ),
            Promise.resolve([])
        )
        : await Promise.all(targets.map(smokeOn));

    results.forEach(report);

    const broken = results.filter((result) => !result.ok);

    ui.blank();
    if (broken.length) throw friendly(`The bundle does not run on ${broken.map((r) => r.target.node).join(', ')}.`);

    ui.note(`The bundle loads and answers on node ${targets.map((target) => target.node).join(', ')}.`);
    ui.blank();
};

main().catch((error) => ui.crash(error));
