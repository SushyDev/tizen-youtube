'use strict';

// Signs and packages the .wgt.
//
//   npm run package
//
// Always builds first: packaging stale output is the kind of mistake that
// costs an hour of confused debugging on the TV.

const { execFileSync } = require('child_process');
const { existsSync, mkdirSync, statSync, rmSync, cpSync } = require('fs');
const { join, dirname } = require('path');

const ui = require('./ui.js');
const { load, ROOT } = require('./config.js');
const { which } = require('./which.js');
const certificates = require('./certificates.js');

// What actually goes into the .wgt, named explicitly.
//
// tizenjs's --ignore matches basenames only, so it cannot express "keep
// service/dist/index.js but drop service/index.js". Staging an allowlist
// instead makes the package contents exact and auditable: nothing ships
// unless it is listed here.
const APP = {
    output: 'release/tube.wgt',
    include: [
        'config.xml',
        'icon.png',
        // The boot screen. config.xml points at ui/dist/index.html.
        'ui/dist',
        // The service, with both userscript bundles under dist/assets — which
        // is what makes a first launch work with no network at all.
        'service/dist'
    ]
};

function friendly(message) {
    const error = new Error(message);
    error.isFriendly = true;
    return error;
}

function checkPrerequisites() {
    const tizenjs = which('tizenjs');
    if (!tizenjs) {
        throw friendly(
            'tizenjs was not found. It ships as a dependency, so this usually\n' +
            '  means the install is incomplete. Run: npm install'
        );
    }

    const found = certificates.locate();
    const absent = certificates.missing(found);

    if (absent.length) {
        throw friendly(
            `Cannot sign:\n  ${absent.join('\n  ')}\n\n  ${certificates.howToMint()}`
        );
    }

    // The distributor half matters as much as the author half, and it is the
    // one that is easy to get wrong. Left to itself tizenjs falls back to the
    // stock Tizen public distributor signer: a Tizen Test CA certificate that
    // expired in October 2022, and that a retail Samsung TV never trusted in
    // the first place. Packages signed with it build fine and are refused at
    // install with
    //
    //   install failed[118, -12] Invalid certificate chain with certificate
    //   in signature
    //
    // which says nothing about which of the two signatures is at fault.
    // Samsung mints both halves together, bound to the TV's DUID, so the
    // distributor p12 normally sits beside the author one.
    return {
        p12: found.author,
        password: found.password,
        distributor: found.distributor,
        distributorPassword: found.distributorPassword,
        tizenjs
    };
}

function packageApp(certificate) {
    const staging = join(ROOT, '.package');
    const outPath = join(ROOT, APP.output);

    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    mkdirSync(join(ROOT, 'release'), { recursive: true });

    // Copy the allowlist in. A missing entry is a build problem, not something
    // to quietly ship without.
    APP.include.forEach((relative) => {
        const from = join(ROOT, relative);
        if (!existsSync(from)) {
            throw friendly(
                `${relative} is missing, and it must be in the package.\n` +
                '  Run `npm run build` first.'
            );
        }
        const to = join(staging, relative);
        mkdirSync(dirname(to), { recursive: true });
        cpSync(from, to, { recursive: true });
    });

    const started = Date.now();
    try {
        execFileSync(certificate.tizenjs, [
            'build', '.',
            '-t', 'wgt',
            '-o', outPath,
            '--author', certificate.p12,
            '--authorPwd', certificate.password,
            '--distributor', certificate.distributor,
            '--distributorPwd', certificate.distributorPassword
        ], { cwd: staging, stdio: 'pipe', encoding: 'utf8' });
    } catch (e) {
        const output = `${e.stdout || ''}${e.stderr || ''}`.trim();
        throw friendly(`Packaging failed.\n\n${output || e.message}`);
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }

    if (!existsSync(outPath)) {
        throw friendly(`tizenjs reported success but produced no file at ${APP.output}.`);
    }

    return { ms: Date.now() - started, size: statSync(outPath).size, path: APP.output };
}

function main() {
    // A release build refuses a placeholder origin. The origin is baked into
    // the package and every TV that installs it, so shipping the example host
    // produces an app that can never be updated over the air.
    const release = process.argv.indexOf('--release') !== -1;

    const config = load({ requireReal: release });
    const certificate = checkPrerequisites();

    // Build first so the package can never contain stale bundles.
    ui.heading('package', `v${config.version}`);
    ui.note(ui.style.dim('  building first...'));
    execFileSync('node', [join(__dirname, 'build.js')], { cwd: ROOT, stdio: 'inherit' });

    ui.group('signing');
    const result = packageApp(certificate);
    ui.ok('youtube', `${ui.bytes(result.size)} · ${result.path}`, result.ms);

    ui.blank();
    ui.note('Packaged.');
    ui.note(ui.style.dim('Install it from Tizen Homebrew on the TV, or: sdb install release/tube.wgt'));
    ui.blank();
}

try {
    main();
} catch (err) {
    ui.crash(err);
}
