'use strict';

// Packages the .wgt, signed or not.
//
//   npm run package                signed for this machine's television
//   npm run package -- --unsigned  signed by nobody, for Tizen Homebrew
//
// Both are useful, and which one is right depends entirely on where the
// package is going. A signature names the television it may be installed on —
// Tizen puts the device id inside the distributor certificate and enforces it
// from Tizen 7 — so a signed build installs on its builder's set and nowhere
// else. That is what you want for `sdb install` on your own TV, and exactly
// what you do not want to attach to a release: it would be a package nobody
// else can install.
//
// Tizen Homebrew re-signs whatever it installs with the pair the television
// holds, and an unsigned package is one of the shapes it accepts, so an
// unsigned .wgt is the one that installs anywhere. A TV will not take it
// directly.
//
// Always builds first: packaging stale output is the kind of mistake that
// costs an hour of confused debugging on the TV.

const { execFileSync } = require('child_process');
const { existsSync, mkdirSync, statSync, rmSync, cpSync, readdirSync, readFileSync, writeFileSync } = require('fs');
const { join, dirname, relative, sep } = require('path');
const JSZip = require('jszip');

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

// Copies the allowlist into an empty directory, which is the package as it
// will be read — by tizenjs, or by the zip below.
function stageContents(staging) {
    APP.include.forEach((entry) => {
        const from = join(ROOT, entry);
        if (!existsSync(from)) {
            throw friendly(
                `${entry} is missing, and it must be in the package.\n` +
                '  Run `npm run build` first.'
            );
        }
        const to = join(staging, entry);
        mkdirSync(dirname(to), { recursive: true });
        cpSync(from, to, { recursive: true });
    });
}

function signWith(certificate, staging, outPath) {
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
    }
}

// A .wgt is a zip, and the only thing tizenjs adds beyond one is the pair of
// signature files. So this is that same zip without them: the same library
// tizenjs uses, the same options, the same walk over the staged directory —
// which leaves an unsigned package differing from a signed one in exactly two
// entries, rather than in ways nobody has looked at.
async function zipUnsigned(staging, outPath) {
    const zip = new JSZip();

    (function add(directory) {
        readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) return add(path);
            // config.xml has to sit at the package root, so paths are stored
            // relative to it, and with the separator a zip is specified in.
            zip.file(relative(staging, path).split(sep).join('/'), readFileSync(path));
        });
    })(staging);

    writeFileSync(outPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

// The certificate is null for an unsigned package, which is the only
// difference between the two paths after staging.
async function packageApp(certificate) {
    const staging = join(ROOT, '.package');
    const outPath = join(ROOT, APP.output);

    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    mkdirSync(join(ROOT, 'release'), { recursive: true });

    const started = Date.now();
    try {
        stageContents(staging);
        if (certificate) signWith(certificate, staging, outPath);
        else await zipUnsigned(staging, outPath);
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }

    if (!existsSync(outPath)) {
        throw friendly(`Packaging reported success but produced no file at ${APP.output}.`);
    }

    return { ms: Date.now() - started, size: statSync(outPath).size, path: APP.output };
}

async function main() {
    const unsigned = process.argv.indexOf('--unsigned') !== -1;

    // A release build refuses a placeholder origin. The origin is baked into
    // the package and every TV that installs it, so shipping the example host
    // produces an app that can never be updated over the air.
    const release = process.argv.indexOf('--release') !== -1;

    const config = load({ requireReal: release });

    // Asked for before the build, so a missing certificate costs a second
    // rather than the whole of it.
    const certificate = unsigned ? null : checkPrerequisites();

    // Build first so the package can never contain stale bundles.
    ui.heading('package', `v${config.version}${unsigned ? ' unsigned' : ''}`);
    ui.note(ui.style.dim('  building first...'));
    execFileSync('node', [join(__dirname, 'build.js')], { cwd: ROOT, stdio: 'inherit' });

    ui.group(unsigned ? 'packaging' : 'signing');
    const result = await packageApp(certificate);
    ui.ok('youtube', `${ui.bytes(result.size)} · ${result.path}`, result.ms);

    ui.blank();
    if (unsigned) {
        ui.note('Packaged, signed by nobody.');
        ui.note(ui.style.dim('Install it through Tizen Homebrew, which signs it for the television it'));
        ui.note(ui.style.dim('runs on. A TV refuses this over sdb — package without --unsigned for that.'));
    } else {
        ui.note('Packaged.');
        ui.note(ui.style.dim('Install it from Tizen Homebrew on the TV, or: sdb install release/tube.wgt'));
    }
    ui.blank();
}

main().catch((err) => ui.crash(err));
