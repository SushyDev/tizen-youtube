'use strict';

const { execFileSync } = require('child_process');
const { existsSync, mkdirSync, statSync, rmSync, cpSync, readdirSync, readFileSync, writeFileSync } = require('fs');
const { join, dirname, relative, sep } = require('path');
const JSZip = require('jszip');

const ui = require('./ui.js');
const { load, ROOT } = require('./config.js');

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

async function writeWidget(staging, outPath) {
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

async function packageApp() {
    const staging = join(ROOT, '.package');
    const outPath = join(ROOT, APP.output);

    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    mkdirSync(join(ROOT, 'release'), { recursive: true });

    const started = Date.now();
    try {
        stageContents(staging);
        await writeWidget(staging, outPath);
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }

    return { ms: Date.now() - started, size: statSync(outPath).size, path: APP.output };
}

async function main() {
    const release = process.argv.indexOf('--release') !== -1;
    const config = load({ requireReal: release });

    ui.heading('package', `v${config.version}`);
    ui.note(ui.style.dim('  building first...'));
    execFileSync('node', [join(__dirname, 'build.js')], { cwd: ROOT, stdio: 'inherit' });

    ui.group('packaging');
    const result = await packageApp();
    ui.ok('youtube', `${ui.bytes(result.size)} · ${result.path}`, result.ms);

    ui.blank();
    ui.note('Packaged, signed by nobody.');
    ui.note(ui.style.dim('Install it through Tizen Homebrew, which signs it for the television it'));
    ui.note(ui.style.dim('runs on. A TV refuses an unsigned widget over sdb.'));
    ui.blank();
}

main().catch((err) => ui.crash(err));
