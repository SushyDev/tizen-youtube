'use strict';

// The Evergreen content path against a local Omaha and a local package server.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const JSZip = require('jszip');

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'tube-evergreen-'));
process.env.TUBE_SHARE = path.join(SCRATCH, 'share');
process.env.TUBE_LOG = path.join(SCRATCH, 'service.log');

const SABI = '{"alignment_char":1,"floating_point_abi":"softfp","sb_api_version":12,"target_arch":"arm","word_size":32}';
const APP_ID = '{6D4E53F3-CC64-4CB8-B6BD-AB0B8F300E1C}';

const STOCK = path.join(SCRATCH, 'cobalt', 'app', 'cobalt', 'content');
const CONTENT = path.join(SCRATCH, 'cobalt-content');

const results = [];
const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
    results.push(!!ok);
};

const u32 = (value) => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value, 0);
    return buffer;
};

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// A package laid out as Evergreen's are: content, then the library, then more content.
const packageOf = async (icuName) => {
    const zip = new JSZip();
    zip.file('manifest.json', '{"version":"9.9.9"}');
    zip.file(`content/icu/${icuName}`, crypto.randomBytes(120000));
    zip.file('content/fonts/fonts.xml', '<new/>');
    zip.file('content/licenses/stored.txt', 'kept as is', { compression: 'STORE' });
    zip.file('content/ssl/certs/abcd1234.0', 'a certificate');
    zip.file('lib/libcobalt.so', crypto.randomBytes(50000), { compression: 'STORE' });
    zip.file('content/web/late.html', 'after the library');

    const body = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const header = crypto.randomBytes(64);
    return Buffer.concat([Buffer.from('Cr24'), u32(3), u32(header.length), header, body]);
};

const offerText = (base, name, version, hash) => `)]}'\n${JSON.stringify({ response: { app: [{
    appid: APP_ID,
    status: 'ok',
    updatecheck: {
        status: 'ok',
        urls: { url: [{ codebase: `${base}/` }] },
        manifest: { version, packages: { package: [{ name, hash_sha256: hash, size: 1 }] } }
    }
}] } })}`;

const NO_UPDATE = `)]}'\n${JSON.stringify({ response: { app: [{ appid: APP_ID, status: 'ok', updatecheck: { status: 'noupdate' } }] } })}`;

const main = async () => {
    const packages = {
        'a.crx': await packageOf('icudt99l.dat'),
        'b.crx': await packageOf('icudt98l.dat'),
        'c.crx': await packageOf('icudt97l.dat'),
        'd.crx': await packageOf('icudt96l.dat')
    };

    // d.crx is served changed, so it no longer matches the hash it is offered with.
    const served = { gets: [], asks: [], changed: { 'd.crx': Buffer.concat([packages['d.crx'], Buffer.from('x')]) } };

    const server = http.createServer((req, res) => {
        if (req.method === 'POST') {
            const parts = [];
            req.on('data', (chunk) => parts.push(chunk));
            req.on('end', () => {
                const request = JSON.parse(Buffer.concat(parts).toString('utf8')).request;
                served.asks.push(request);
                const byYear = { 2020: ['a.crx', '3.7.2'], 2021: ['b.crx', '3.6.2'], 2022: ['a.crx', '3.7.2'] };
                const offered = byYear[request.year];
                const base = `http://127.0.0.1:${server.address().port}`;
                res.end(offered ? offerText(base, offered[0], offered[1], sha(packages[offered[0]])) : NO_UPDATE);
            });
            return;
        }

        const name = req.url.slice(1);
        served.gets.push(name);
        const body = served.changed[name] || packages[name];
        res.statusCode = body ? 200 : 404;
        res.end(body || '');
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    process.env.TUBE_OMAHA_URL = `${base}/service/update2/json`;

    const omaha = require('../lib/omaha.js');
    const { sabiIn, sabiOf, versionOf } = require('../lib/builtInCobalt.js');
    const { merge } = require('../lib/contentMerge.js');
    const evergreen = require('../lib/evergreen.js');

    // The built-in Cobalt, its SABI buried in the library as Samsung's is.
    fs.mkdirSync(path.join(STOCK, '..', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(STOCK, '..', 'lib', 'libcobalt.so'),
        Buffer.concat([crypto.randomBytes(5000), Buffer.from(`${SABI}.': Modifying`), crypto.randomBytes(5000)]));
    fs.writeFileSync(path.join(STOCK, '..', 'manifest.json'), '{ "manifest_version": 2, "name": "Cobalt", "version": "1.6.1" }');

    // Our copy of the built-in content: 21's ICU folder and its fonts.
    fs.mkdirSync(path.join(CONTENT, 'icu', 'icudt56l'), { recursive: true });
    fs.writeFileSync(path.join(CONTENT, 'icu', 'icudt56l', 'root.res'), 'icu 56');
    fs.mkdirSync(path.join(CONTENT, 'fonts'), { recursive: true });
    fs.writeFileSync(path.join(CONTENT, 'fonts', 'fonts.xml'), '<old/>');

    check('it finds the SABI the built-in library embeds, byte for byte', sabiIn(Buffer.from(`xx${SABI}yy`)) === SABI
        && sabiOf(STOCK) === SABI);
    check('and the built-in Evergreen version', versionOf(STOCK) === '1.6.1');

    const request = omaha.requestFor({ sabi: SABI, version: '1.6.1', year: 2020 }).request;
    check('it asks Omaha with the six fields it needs', request.protocol === '3.1' && request.SABI === SABI
        && request.sbversion === '12' && request.brand === 'Samsung' && request.year === '2020'
        && request.updaterchannel === 'prod' && request.app[0].appid === APP_ID && request.app[0].version === '1.6.1',
    JSON.stringify(request));

    const offer = omaha.offerOf(offerText('https://dl.example', 'x.crx', '3.7.2', 'ab')
        .replace('"urls":{"url":[', '"urls":{"url":[{"codebase":"http://plain.example/"},'));
    check('an offer names the package and its hash, https first', offer.version === '3.7.2' && offer.sha256 === 'ab'
        && offer.urls[0] === 'https://dl.example/x.crx' && offer.urls[1] === 'http://plain.example/x.crx', JSON.stringify(offer));
    check('and no update is no offer', omaha.offerOf(NO_UPDATE) === null);

    const added = merge(CONTENT, [
        { name: '../escaped.txt', data: Buffer.from('no') },
        { name: 'fonts/fonts.xml', data: Buffer.from('<replaced/>') },
        { name: 'licenses/new.txt', data: Buffer.from('yes') }
    ]);
    check('a merge adds only what is missing and never leaves the folder', added.join() === 'licenses/new.txt'
        && !fs.existsSync(path.join(SCRATCH, 'escaped.txt'))
        && fs.readFileSync(path.join(CONTENT, 'fonts', 'fonts.xml'), 'utf8') === '<old/>');

    const beforeBootstrap = Date.now();
    check('nothing has been merged before it starts', !evergreen.mergedSince(beforeBootstrap));
    await evergreen.bootstrap(CONTENT, STOCK);
    check('and it says when a merge landed', evergreen.mergedSince(beforeBootstrap));

    // Taken from the source rather than spelled again: the first year is evergreen.js's to know.
    const years = new Date().getFullYear() - evergreen.FIRST_YEAR + 1;
    check('it asks for every model year', served.asks.length === years
        && served.asks[0].year === String(evergreen.FIRST_YEAR),
    served.asks.map((ask) => ask.year).join());
    check('and takes each distinct package offered, once', served.gets.join() === 'a.crx,b.crx', served.gets.join());
    check('adding its ICU beside the ICU and fonts we already had',
        fs.existsSync(path.join(CONTENT, 'icu', 'icudt99l.dat')) && fs.existsSync(path.join(CONTENT, 'icu', 'icudt98l.dat'))
        && fs.readFileSync(path.join(CONTENT, 'icu', 'icudt56l', 'root.res'), 'utf8') === 'icu 56'
        && fs.readFileSync(path.join(CONTENT, 'fonts', 'fonts.xml'), 'utf8') === '<old/>');
    check('with every content file, deflated or stored, before or after the library',
        fs.readFileSync(path.join(CONTENT, 'licenses', 'stored.txt'), 'utf8') === 'kept as is'
        && fs.existsSync(path.join(CONTENT, 'ssl', 'certs', 'abcd1234.0'))
        && fs.readFileSync(path.join(CONTENT, 'web', 'late.html'), 'utf8') === 'after the library'
        && !fs.existsSync(path.join(CONTENT, 'lib')));

    await evergreen.bootstrap(CONTENT, STOCK);
    check('a package already merged is not fetched again', served.asks.length === years * 2
        && served.gets.join() === 'a.crx,b.crx', served.gets.join());

    await evergreen.heardOffer(offerText(base, 'c.crx', '3.8.0', sha(packages['c.crx'])));
    check('a package Cobalt is offered through us is taken too', fs.existsSync(path.join(CONTENT, 'icu', 'icudt97l.dat')));

    await evergreen.heardOffer(offerText(base, 'd.crx', '3.9.0', sha(packages['d.crx'])));
    const state = JSON.parse(fs.readFileSync(path.join(process.env.TUBE_SHARE, 'evergreen.json'), 'utf8'));
    check('a package that does not match its hash is refused, and not recorded as merged',
        !fs.existsSync(path.join(CONTENT, 'icu', 'icudt96l.dat')) && state.merged.indexOf('d.crx') === -1
        && /does not match/.test(fs.readFileSync(process.env.TUBE_LOG, 'utf8')), JSON.stringify(state));

    check('what it merged is on record', state.merged.join() === 'a.crx,b.crx,c.crx', JSON.stringify(state));

    server.close();
};

main().catch((error) => check('the Evergreen path runs', false, error.stack)).then(() => {
    fs.rmSync(SCRATCH, { recursive: true, force: true });
    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
});
