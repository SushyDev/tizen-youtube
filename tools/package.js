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

// Diagnostic packaging, added to the staged copy so the file in the repository stays the
// file that ships:
//
//   TUBE_GAME_MODE=1 npm run package -- --unsigned
//
// use.game.mode is what makes the platform's renderer count frames — a pristine
// getVideoPlaybackQuality reads 0/0/0 through a playing video otherwise. It is said to
// cost frames, so a package built with it is for measuring and not for watching.
const GAME_MODE = '<tizen:metadata key="http://samsung.com/tv/metadata/use.game.mode" value="true"/>';

const wantsGameMode = () => process.env.TUBE_GAME_MODE === '1';

const xmlAttribute = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// Opt-in profile for testing Cobalt's native HTTPS origin and trust path.
//
// --content is the loader's *alternative content directory*, and it replaces the Evergreen
// content directory wholesale: `starboard/loader_app/loader_app.cc` substitutes it for
// `<content>/app/cobalt/content`, and `slot_management.cc` for `<installation>/content`. So it
// names the directory that directly holds `fonts/`, `icu/`, `licenses/` and `ssl/certs/` — not the
// loader root above it, and not `app/cobalt`. It has no bearing on where libcobalt is loaded
// from, so the copy needs no `manifest.json` and no `lib/`.
function addCobaltProfile(staging) {
    const baseUrl = process.env.TUBE_COBALT_BASE_URL;
    const proxyUrl = process.env.TUBE_COBALT_PROXY;
    const content = process.env.TUBE_COBALT_CONTENT;
    if (!baseUrl && !proxyUrl && !content) return;
    if (!baseUrl || !proxyUrl) {
        throw friendly('TUBE_COBALT_BASE_URL and TUBE_COBALT_PROXY must be supplied together.');
    }
    if (content && /[\s"&<>]/.test(content)) {
        throw friendly('TUBE_COBALT_CONTENT must be a path without whitespace or XML characters.');
    }
    if (content && /\/app\/cobalt$|\/app$/.test(content)) {
        throw friendly(
            `TUBE_COBALT_CONTENT names the Evergreen content directory itself, not the tree above\n` +
            `  it. ${content}/content is probably what you meant.`
        );
    }

    let base;
    let proxy;
    try { base = new URL(baseUrl); } catch (e) {
        throw friendly(`TUBE_COBALT_BASE_URL is not a URL: ${baseUrl}`);
    }
    try { proxy = new URL(proxyUrl); } catch (e) {
        throw friendly(`TUBE_COBALT_PROXY is not a URL: ${proxyUrl}`);
    }
    if (base.protocol !== 'https:') {
        throw friendly('TUBE_COBALT_BASE_URL must use https.');
    }
    if (proxy.protocol !== 'http:') {
        throw friendly('TUBE_COBALT_PROXY must use http.');
    }

    const path = join(staging, 'config.xml');
    let xml = readFileSync(path, 'utf8');
    const metadata = 'http://samsung.com/tv/metadata/native.userdata';
    const expression = new RegExp(`(<tizen:metadata\\s+key="${metadata}"\\s+value=")([^"]*)("\\s*/>)`);
    if (!expression.test(xml)) throw friendly('config.xml has no Cobalt native.userdata metadata.');

    // Only --base_url, --proxy and --content are this profile's business. Replacing the whole
    // switch list drops --use_eden and --dial_name, and without those the container reports a
    // successful launch and then never appears in getAppsContext at all.
    const existing = expression.exec(xml)[2].split(/\s+/).filter(Boolean)
        .filter((argument) => !/^--(base_url|proxy|content)=/.test(argument));

    const args = [
        `--base_url=${baseUrl}`,
        `--proxy=${proxyUrl}`,
        content ? `--content=${content}` : null,
        ...existing
    ].filter(Boolean).join(' ');
    xml = xml.replace(expression, `$1${xmlAttribute(args)}$3`);
    writeFileSync(path, xml);
}

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
        addCobaltProfile(staging);
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

    const release = process.argv.indexOf('--release') !== -1;

    const config = load({ requireReal: release });

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
