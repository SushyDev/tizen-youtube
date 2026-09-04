'use strict';

const { execFileSync } = require('child_process');
const { existsSync, mkdirSync, statSync, rmSync, cpSync, readdirSync, readFileSync, writeFileSync } = require('fs');
const { join, dirname, relative, sep } = require('path');
const JSZip = require('jszip');

const ui = require('./ui.js');
const { load, ROOT } = require('./config.js');
const { which } = require('./which.js');
const certificates = require('./certificates.js');

const APP = {
    output: 'release/tube.wgt',
    include: [
        'config.xml',
        'icon.png',
        'ui/dist',
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

    return {
        p12: found.author,
        password: found.password,
        distributor: found.distributor,
        distributorPassword: found.distributorPassword,
        tizenjs
    };
}

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

async function zipUnsigned(staging, outPath) {
    const zip = new JSZip();

    (function add(directory) {
        readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) return add(path);
            zip.file(relative(staging, path).split(sep).join('/'), readFileSync(path));
        });
    })(staging);

    writeFileSync(outPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

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

    const release = process.argv.indexOf('--release') !== -1;

    const config = load({ requireReal: release });

    const certificate = unsigned ? null : checkPrerequisites();

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
