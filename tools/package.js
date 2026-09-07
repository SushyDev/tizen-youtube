'use strict';

const { execFileSync } = require('child_process');
const { existsSync, mkdirSync, statSync, rmSync, cpSync, readdirSync, readFileSync, writeFileSync } = require('fs');
const { join, dirname, relative, sep } = require('path');
const JSZip = require('jszip');

const ui = require('./report.js');
const { load, ROOT } = require('./config.js');
const paths = require('./paths.js');

const APP = { output: paths.WGT, include: paths.WIDGET };

function friendly(message) {
    const error = new Error(message);
    error.isFriendly = true;
    return error;
}

function stageContents(staging) {
    APP.include.forEach((entry) => {
        const from = join(ROOT, entry.from);
        if (!existsSync(from)) {
            throw friendly(
                `${entry.from} is missing, and it must be in the package.\n` +
                '  Run `npm run build` first.'
            );
        }
        const to = join(staging, entry.to);
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

// A proxy port changed here but not there is a television that shows nothing and says nothing:
// the container is launched pointing at a port the service is not on. Cheap to check, and the
// failure it prevents costs an install and a reboot to diagnose.
function checkThePortsAgree(staging, expected) {
    const xml = readFileSync(join(staging, 'config.xml'), 'utf8');
    const named = /--proxy=http:\/\/[^:\s"]+:(\d+)/.exec(xml);

    if (!named) throw friendly('config.xml has no --proxy switch to check.');
    if (Number(named[1]) === Number(expected)) return;

    throw friendly(
        `config.xml launches the container against port ${named[1]}, but tizen.config.json says\n` +
        `  the proxy is on ${expected}. One of the two is wrong, and the set would show nothing.`
    );
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

async function packageApp(config) {
    const staging = join(ROOT, '.package');
    const outPath = join(ROOT, APP.output);

    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    mkdirSync(join(ROOT, paths.RELEASE), { recursive: true });

    const started = Date.now();
    try {
        stageContents(staging);
        addCobaltProfile(staging);
        checkThePortsAgree(staging, config.ports.proxy);
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
    const result = await packageApp(config);
    ui.ok('youtube', `${ui.bytes(result.size)} · ${result.path}`, result.ms);

    ui.blank();
    ui.note('Packaged, signed by nobody.');
    ui.note(ui.style.dim('Install it through Tizen Homebrew, which signs it for the television it'));
    ui.note(ui.style.dim('runs on. A TV refuses an unsigned widget over sdb.'));
    ui.blank();
}

main().catch((err) => ui.crash(err));
