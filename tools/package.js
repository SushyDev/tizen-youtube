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

// use.game.mode is what makes getVideoPlaybackQuality count frames at all.
const GAME_MODE = '<tizen:metadata key="http://samsung.com/tv/metadata/use.game.mode" value="true"/>';

const wantsGameMode = () => process.env.TUBE_GAME_MODE === '1';

const xmlAttribute = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// Not every Tizen device has the container — a Smart Monitor is not a television — and on one that
// does not, the metadata hands the launch to something absent, our own content never runs, and
// nothing starts the service. TUBE_COBALT_CONTAINER=off drops the three keys and the app is the
// ordinary Chromium one again.
function withoutContainer(staging) {
    if (process.env.TUBE_COBALT_CONTAINER !== 'off') return;

    const path = join(staging, 'config.xml');
    const keys = ['pkgid', 'nativeID', 'native.userdata'];

    const xml = keys.reduce((text, key) => text.replace(
        new RegExp(`\\s*<tizen:metadata\\s+key="http://samsung\\.com/tv/metadata/${key}"[^>]*/>`), ''
    ), readFileSync(path, 'utf8'));

    keys.forEach((key) => {
        if (xml.indexOf(`metadata/${key}"`) !== -1) throw friendly(`Could not remove the ${key} metadata.`);
    });

    writeFileSync(path, xml);
}

function addCobaltProfile(staging) {
    if (process.env.TUBE_COBALT_CONTAINER === 'off') return;

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
    // --content replaces the Evergreen content directory wholesale, so it names the directory that
    // directly holds fonts/, icu/, licenses/ and ssl/certs/ — not the loader root above it.
    if (content && /\/app\/cobalt$|\/app$/.test(content)) {
        throw friendly(
            'TUBE_COBALT_CONTENT names the Evergreen content directory itself, not the tree above\n' +
            `  it. ${content}/content is probably what you meant.`
        );
    }

    const checkUrl = (name, value, scheme) => {
        const parsed = (() => {
            try { return new URL(value); } catch (e) { return null; }
        })();

        if (!parsed) throw friendly(`${name} is not a URL: ${value}`);
        if (parsed.protocol !== scheme) throw friendly(`${name} must use ${scheme.slice(0, -1)}.`);
    };

    checkUrl('TUBE_COBALT_BASE_URL', baseUrl, 'https:');
    checkUrl('TUBE_COBALT_PROXY', proxyUrl, 'http:');

    const path = join(staging, 'config.xml');
    const xml = readFileSync(path, 'utf8');
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

    writeFileSync(path, xml.replace(expression, `$1${xmlAttribute(args)}$3`));
}

function addGameMode(staging) {
    const path = join(staging, 'config.xml');
    const xml = readFileSync(path, 'utf8');

    if (xml.indexOf('metadata/use.game.mode"') !== -1) return;

    writeFileSync(path, xml.replace('</widget>', `    ${GAME_MODE}\n</widget>`));
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
        addCobaltProfile(staging);
        withoutContainer(staging);
        if (wantsGameMode()) addGameMode(staging);
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
    if (wantsGameMode()) ui.note(ui.style.dim('  use.game.mode is on: a package for measuring, not for watching.'));
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
