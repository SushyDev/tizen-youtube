'use strict';

// Packages the .wgt, signed or not. Always builds first.
//
//   npm run package                signed for this machine's television
//   npm run package -- --unsigned  signed by nobody, for Tizen Homebrew
//
// A signature names the television it may be installed on, and Tizen Homebrew re-signs
// what it installs — so the unsigned .wgt installs anywhere, and a TV refuses it over sdb.

const { execFileSync } = require('child_process');
const { existsSync, mkdirSync, statSync, rmSync, cpSync, readdirSync, readFileSync, writeFileSync } = require('fs');
const { join, dirname, relative, sep } = require('path');
const JSZip = require('jszip');

const ui = require('./ui.js');
const { load, ROOT } = require('./config.js');
const { which } = require('./which.js');
const certificates = require('./certificates.js');

// tizenjs's --ignore matches basenames only, so it cannot express "keep
// service/dist/index.js but drop service/index.js". Nothing ships unless listed here.
const APP = {
    output: 'release/tube.wgt',
    include: [
        'config.xml',
        'icon.png',
        // The boot screen. config.xml points at ui/dist/index.html.
        'ui/dist',
        // Both userscript bundles sit under dist/assets, which is what makes a first
        // launch work with no network at all.
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

    // Left to itself tizenjs signs with the stock Tizen public distributor certificate,
    // which expired in October 2022 and no retail Samsung TV ever trusted. Packages
    // signed with it are refused at install with `install failed[118, -12] Invalid
    // certificate chain`, which says nothing about which signature is at fault. Samsung
    // mints both halves together, so the distributor p12 sits beside the author one.
    return {
        p12: found.author,
        password: found.password,
        distributor: found.distributor,
        distributorPassword: found.distributorPassword,
        tizenjs
    };
}

// Copies the allowlist into an empty directory: the package as it will be read.
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

// Diagnostic packaging: a key that must never reach a release, added to the staged copy
// so the file in the repository stays the file that ships.
//
//     TUBE_GAME_MODE=1 npm run package -- --unsigned
//
// use.game.mode is what makes the platform's renderer count frames. Nothing counts them
// otherwise on this hardware — a pristine getVideoPlaybackQuality reads 0/0/0 through a
// playing video — so every figure in the stats panel is our own arithmetic, with nothing
// to check it against. This is the one documented way to get a real number. It is said to
// cost frames, which is why it is opt-in and why a package built with it is for measuring
// and not for watching.
const GAME_MODE = '<tizen:metadata key="http://samsung.com/tv/metadata/use.game.mode" value="true"/>';

const wantsGameMode = () => process.env.TUBE_GAME_MODE === '1';

function addGameMode(staging) {
    const path = join(staging, 'config.xml');
    const xml = readFileSync(path, 'utf8');

    if (xml.indexOf('metadata/use.game.mode"') !== -1) return;

    writeFileSync(path, xml.replace('</widget>', `    ${GAME_MODE}\n</widget>`));
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

// A .wgt is a zip and the only thing tizenjs adds is the pair of signature files. Same
// library, same options, same walk, so the two packages differ in exactly two entries.
async function zipUnsigned(staging, outPath) {
    const zip = new JSZip();

    (function add(directory) {
        readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) return add(path);
            // config.xml has to sit at the package root, and a zip specifies '/'.
            zip.file(relative(staging, path).split(sep).join('/'), readFileSync(path));
        });
    })(staging);

    writeFileSync(outPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

// The certificate is null for an unsigned package, the only difference after staging.
async function packageApp(certificate) {
    const staging = join(ROOT, '.package');
    const outPath = join(ROOT, APP.output);

    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    mkdirSync(join(ROOT, 'release'), { recursive: true });

    const started = Date.now();
    try {
        stageContents(staging);
        if (wantsGameMode()) addGameMode(staging);
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

    // A release build refuses a placeholder origin: it is baked into every TV that
    // installs the package, so the example host means no OTA updates ever.
    const release = process.argv.indexOf('--release') !== -1;

    const config = load({ requireReal: release });

    // Before the build, so a missing certificate costs a second rather than the whole build.
    const certificate = unsigned ? null : checkPrerequisites();

    ui.heading('package', `v${config.version}${unsigned ? ' unsigned' : ''}`);
    if (wantsGameMode()) ui.note(ui.style.dim('  use.game.mode is on: a package for measuring, not for watching.'));
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
