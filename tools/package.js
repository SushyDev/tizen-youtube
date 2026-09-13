'use strict';

const { execFileSync } = require('child_process');
const { existsSync, mkdirSync, statSync, rmSync, cpSync, readdirSync, readFileSync, writeFileSync } = require('fs');
const { join, dirname, relative, sep } = require('path');
const JSZip = require('jszip');

const ui = require('./report.js');
const { load, parseUrl, ROOT } = require('./config.js');
const paths = require('./paths.js');
const { PROXY } = require('../service/lib/ports.js');

// Cobalt 20 cannot trust our CA, so the 5.0+ widget loads the page from the service instead.
const APPS = [
    { label: 'youtube 5.5+', output: paths.WGT, include: paths.WIDGET, requiredVersion: null, servedFrom: null, packageId: null },
    {
        label: 'youtube 5.0+',
        output: paths.WGT_LEGACY,
        include: paths.WIDGET_LEGACY,
        requiredVersion: '5.0',
        servedFrom: `http://127.0.0.2:${PROXY}/tv`,
        // Its own package, so neither widget installs over the other.
        packageId: 'tUb3Xq7L50'
    }
];

function friendly(message) {
    const error = new Error(message);
    error.isFriendly = true;
    return error;
}

function stageContents(staging, app) {
    app.include.forEach((entry) => {
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
        const parsed = parseUrl(value);

        if (!parsed) throw friendly(`${name} is not a URL: ${value}`);
        if (parsed.protocol !== scheme) throw friendly(`${name} must use ${scheme.slice(0, -1)}.`);
    };

    // Cobalt allows plain http only to loopback and private addresses, even in a gold build.
    const privateHost = /^http:\/\/(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(baseUrl);
    checkUrl('TUBE_COBALT_BASE_URL', baseUrl, privateHost ? 'http:' : 'https:');
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
    if (PROXY !== Number(expected)) {
        throw friendly(
            `service/lib/ports.js binds the proxy on ${PROXY}, but tizen.config.json says it is on\n` +
            `  ${expected}. One of the two is wrong, and the set would show nothing.`
        );
    }

    const xml = readFileSync(join(staging, 'config.xml'), 'utf8');
    const named = /--proxy=http:\/\/[^:\s"]+:(\d+)/.exec(xml);

    if (!named) throw friendly('config.xml has no --proxy switch to check.');
    if (Number(named[1]) === Number(expected)) return;

    throw friendly(
        `config.xml launches the container against port ${named[1]}, but tizen.config.json says\n` +
        `  the proxy is on ${expected}. One of the two is wrong, and the set would show nothing.`
    );
}

// Tizen refuses to install a widget whose required_version is above the platform's own.
function setRequiredVersion(staging, version) {
    const path = join(staging, 'config.xml');
    const xml = readFileSync(path, 'utf8');
    const expression = /(<tizen:application\b[^>]*\brequired_version=")[^"]*(")/;

    if (!expression.test(xml)) throw friendly('config.xml has no required_version to set.');

    writeFileSync(path, xml.replace(expression, `$1${version}$2`));
}

// Renames the package everywhere config.xml names it: the package, the app and the service.
function setPackageId(staging, id) {
    const path = join(staging, 'config.xml');
    const xml = readFileSync(path, 'utf8');
    const found = /<tizen:application\b[^>]*\bpackage="([^"]+)"/.exec(xml);

    if (!found) throw friendly('config.xml names no package to rename.');
    if (!/^[0-9A-Za-z]{10}$/.test(id)) throw friendly(`A package id is ten letters and digits, not ${id}.`);

    writeFileSync(path, xml.split(found[1]).join(id));
}

// Points --base_url at the service and drops --content, which Cobalt 20 does not have.
function servePage(staging, baseUrl) {
    const path = join(staging, 'config.xml');
    const xml = readFileSync(path, 'utf8');
    const expression = /(<tizen:metadata\s+key="http:\/\/samsung\.com\/tv\/metadata\/native\.userdata"\s+value=")([^"]*)("\s*\/>)/;

    if (!expression.test(xml)) throw friendly('config.xml has no Cobalt native.userdata metadata.');

    const kept = expression.exec(xml)[2].split(/\s+/).filter(Boolean)
        .filter((argument) => !/^--(base_url|content)=/.test(argument));

    writeFileSync(path, xml.replace(expression, `$1${xmlAttribute([`--base_url=${baseUrl}`].concat(kept).join(' '))}$3`));
}

function addGameMode(staging) {
    const path = join(staging, 'config.xml');
    const xml = readFileSync(path, 'utf8');

    if (xml.indexOf('metadata/use.game.mode"') !== -1) return;

    writeFileSync(path, xml.replace('</widget>', `    ${GAME_MODE}\n</widget>`));
}

// Zip entry names are the staged path, always with forward slashes: a widget built on Windows
// has to unpack the same as one built here.
function addTree(zip, staging, directory) {
    readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return addTree(zip, staging, path);
        zip.file(relative(staging, path).split(sep).join('/'), readFileSync(path));
    });
}

async function writeWidget(staging, outPath) {
    const zip = new JSZip();

    addTree(zip, staging, staging);

    writeFileSync(outPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function packageApp(config, app) {
    const staging = join(ROOT, '.package');
    const outPath = join(ROOT, app.output);

    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    mkdirSync(join(ROOT, paths.RELEASE), { recursive: true });

    const started = Date.now();
    try {
        stageContents(staging, app);
        if (app.requiredVersion) setRequiredVersion(staging, app.requiredVersion);
        if (app.packageId) setPackageId(staging, app.packageId);
        if (app.servedFrom) servePage(staging, app.servedFrom);
        addCobaltProfile(staging);
        checkThePortsAgree(staging, config.ports.proxy);
        if (wantsGameMode()) addGameMode(staging);
        await writeWidget(staging, outPath);
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }

    return { ms: Date.now() - started, size: statSync(outPath).size, path: app.output, label: app.label };
}

async function main() {
    const config = load();

    ui.heading('package', `v${config.version}`);
    if (wantsGameMode()) ui.note(ui.style.dim('  use.game.mode is on: a package for measuring, not for watching.'));
    ui.note(ui.style.dim('  building first...'));
    execFileSync('node', [join(__dirname, 'build.js')], { cwd: ROOT, stdio: 'inherit' });

    ui.group('packaging');
    // One at a time: both stage through .package.
    const results = await APPS.reduce(
        (queue, app) => queue.then((done) => packageApp(config, app).then((result) => done.concat(result))),
        Promise.resolve([])
    );
    results.forEach((result) => ui.ok(result.label, `${ui.bytes(result.size)} · ${result.path}`, result.ms));

    ui.blank();
    ui.note('Packaged, signed by nobody.');
    ui.note(ui.style.dim('Install it through Tizen Homebrew, which signs it for the television it'));
    ui.note(ui.style.dim('runs on. A TV refuses an unsigned widget over sdb.'));
    ui.blank();
}

main().catch((err) => ui.crash(err));
