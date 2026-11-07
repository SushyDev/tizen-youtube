'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { rollup } = require('rollup');

const { BOOT_URL, html, writeBootScreen } = require('../lib/bootScreen.js');

const results = [];

const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  <- ${detail}`}`);
    results.push(!!ok);
};

const AGENT = 'Mozilla/5.0 (Linux; Tizen 9.0) Cobalt/25.lts.30.1034943-gold (unlike Gecko) v8/8.8 gles '
    + 'Evergreen/5.30.2 Evergreen-Full Starboard/16';

// What the service's HTML hands the page, with one fallback address rather than this machine's.
const WRITTEN = JSON.parse(/window\.TUBE_BOOT = (\{[^<]*\});/.exec(html(''))[1]);
const ELSEWHERE = 'http://127.0.0.1:8099';
const CONFIG = Object.assign({}, WRITTEN, { alternates: [ELSEWHERE] });

const bundled = async () => {
    const bundle = await rollup({ input: path.join(__dirname, '..', 'boot', 'index.js') });
    const { output } = await bundle.generate({ format: 'iife' });
    return output[0].code;
};

const storage = () => {
    const kept = {};
    return {
        getItem: (key) => (key in kept ? kept[key] : null),
        setItem: (key, value) => { kept[key] = String(value); },
        removeItem: (key) => { delete kept[key]; }
    };
};

// Only as much of a page as the boot screen touches; replies[] answers each ask in turn.
const run = (script, replies, turns, options) => {
    const probeStatus = options && options.probe !== undefined ? options.probe : 204;
    const elsewhereStatus = options && options.elsewhere !== undefined ? options.elsewhere : 0;
    const hangs = !!(options && options.hang);
    const updater = options && options.updater;
    const answered = { count: 0 };
    const node = () => ({
        className: '',
        textContent: '',
        style: {},
        kids: [],
        get childNodes() { return this.kids; },
        appendChild(kid) { this.kids.push(kid); },
        removeChild(kid) { this.kids.splice(this.kids.indexOf(kid), 1); }
    });
    const log = node();
    const nodes = { log };
    const byId = (id) => {
        if (!nodes[id]) nodes[id] = node();
        return nodes[id];
    };
    const support = options && options.support;
    const posted = [];
    const timers = [];
    const asked = [];
    const replaced = [];
    const clock = { now: 0 };

    function XMLHttpRequest() {}
    XMLHttpRequest.prototype.open = function open(method, url) { this.method = method; this.url = url; };
    XMLHttpRequest.prototype.abort = function abort() {};
    XMLHttpRequest.prototype.setRequestHeader = function setRequestHeader() {};
    XMLHttpRequest.prototype.send = function send(body) {
        asked.push(this.url);
        this.readyState = 4;

        if (this.method === 'POST') {
            posted.push({ url: this.url, body: JSON.parse(body) });
            this.status = support === 'down' ? 0 : 201;
            this.responseText = support === 'down' ? '' : JSON.stringify({ code: 'K7QF-29XM', url: 'https://help.example/r/K7QF-29XM' });
            if (this.onreadystatechange) this.onreadystatechange();
            return;
        }

        // The probe goes to YouTube through Cobalt's proxy; a fire-and-forget send has no handler.
        if (this.url.indexOf(`${ELSEWHERE}/__tube/ping`) === 0) {
            this.status = elsewhereStatus;
            this.responseText = '';
        } else if (this.url.indexOf('/__tube/ping') !== -1) {
            this.status = probeStatus;
            this.responseText = '';
        } else if (hangs && this.url.indexOf(CONFIG.service) === 0) {
            // Dropped: only the page's own guard ends the wait.
            return;
        } else if (this.onreadystatechange) {
            const reply = replies[Math.min(answered.count, replies.length - 1)];
            answered.count += 1;
            this.status = reply ? 200 : 0;
            this.responseText = reply ? JSON.stringify(reply) : '';
        }

        if (this.onreadystatechange) this.onreadystatechange();
    };

    const page = {
        document: { getElementById: byId, createElement: node },
        navigator: { userAgent: AGENT },
        XMLHttpRequest,
        setTimeout: (act, delay) => timers.push({ act, delay: delay || 0 }),
        window: {
            TUBE_BOOT: support ? Object.assign({}, CONFIG, { supportUrl: 'https://help.example' }) : CONFIG,
            performance: { now: () => clock.now },
            innerWidth: 1920,
            innerHeight: 1080,
            devicePixelRatio: 1,
            h5vcc: updater ? { updater } : undefined,
            location: {
                href: 'file:///tube/boot.html?launch=menu&cert_scope=samsung',
                search: '?launch=menu&cert_scope=samsung',
                hash: '',
                replace: (to) => replaced.push(to)
            },
            localStorage: options && options.storage ? storage() : undefined
        }
    };

    vm.runInNewContext(script, page);

    // Each timer moves the page's clock on by its own delay, so waiting takes time as it would.
    Array.from({ length: turns }).forEach(() => {
        const next = timers.shift();
        if (!next) return;

        clock.now += next.delay;
        next.act();
    });

    const lines = log.childNodes.map((line) => ({
        text: line.kids.map((kid) => kid.textContent).join(''),
        tone: line.kids[2] ? line.kids[2].className : ''
    }));

    const card = {
        tone: byId('card').className,
        head: byId('state').textContent,
        detail: byId('detail').textContent,
        steps: byId('steps').kids.map((step) => step.textContent),
        label: byId('aside-label').textContent,
        code: byId('aside-code').textContent,
        url: byId('aside-url').textContent,
        version: byId('version').textContent,
        qr: byId('qr').style.display === 'block' ? byId('qr').kids.length : 0
    };

    return { lines, asked, replaced, card, posted };
};

const host = (url) => url.replace('http://', '');
const has = (lines, fragment) => lines.some((line) => line.text.indexOf(fragment) !== -1);
const toneOf = (lines, fragment) => (lines.find((line) => line.text.indexOf(fragment) !== -1) || {}).tone;

const FACTS = {
    patch: '1.0.1-abc1234-clean', tizen: '9.0', model: 'QE65S93DATXXN', node: 'v18.18.2', pid: 4384,
    script: { bytes: 88064 }
};

const ready = { facts: FACTS, ready: true, waiting: null, log: [{ seq: 0, what: 'listening', text: '0.0.0.0:8099' }], next: 1 };

const checks = (script) => {
    const handed = run(script, [null, null, ready], 12);

    check('it names the Cobalt it runs in', has(handed.lines, 'boot screen, cobalt 25.lts.30.1034943-gold, evergreen 5.30.2, starboard 16'));

    const pinned = run(script, [ready], 3, {
        updater: { getInstallationIndex: () => 1000, getUpdaterChannel: () => 'prod', getUpdateStatus: () => '' }
    });
    check('it says when updates are off', has(pinned.lines, 'cobalt: installation 1000 (built-in, updates off), channel prod'),
        pinned.lines.map((line) => line.text).join(' | '));

    const updated = run(script, [ready], 3, {
        updater: {
            getInstallationIndex: () => 1,
            getUpdaterChannel: () => { throw new Error('refused'); },
            getUpdateStatus: () => 'Update installed, pending restart'
        }
    });
    check('and which Evergreen update runs, leaving out what it cannot read',
        has(updated.lines, 'cobalt: installation 1 (evergreen update 1), update Update installed, pending restart'),
        updated.lines.map((line) => line.text).join(' | '));
    check('a Cobalt without an updater says nothing of it', !has(handed.lines, 'cobalt: '));
    check('it says when the service answers', has(handed.lines, 'service: answering after'));
    check('it prints the Patch stamp Settings shows', has(handed.lines, 'tube: patch 1.0.1-abc1234-clean'));
    check('and the Tizen version, model and node', has(handed.lines, 'platform: tizen 9.0, QE65S93DATXXN')
        && has(handed.lines, 'service: node v18.18.2, pid 4384'));
    check('it shows the service log in its own colours', toneOf(handed.lines, 'listening: 0.0.0.0:8099') === 'ok');
    const boots = handed.asked.filter((url) => url.indexOf('/__tube/boot?') !== -1);
    check('it tells the service how long it waited, once', boots.filter((url) => url.indexOf('waited=') !== -1).length === 3
        && boots.slice(3).every((url) => url.indexOf('waited=') === -1), boots.join(' '));
    check('it hands over to the page we serve, with its own query',
        handed.replaced[0] === `${CONFIG.service}/tv?launch=menu&cert_scope=samsung`,
        handed.replaced.join(' '));
    check('before handing over it asks for that page\'s own address',
        handed.asked.some((url) => url.indexOf(`${CONFIG.service}/__tube/ping?`) === 0),
        handed.asked.join(' '));

    const stuck = run(script, [{
        facts: FACTS, ready: false, next: 0, log: [{ seq: 0, what: 'upstream', text: 'upstream failed on https://www.youtube.com/tv: ENOTFOUND' }],
        waiting: { tone: 'bad', what: 'www.youtube.com is not reachable from the TV (ENOTFOUND)' }
    }], 12);

    check('a broken start stays on the log', stuck.replaced.length === 0);
    check('a service that is wrong rather than slow has everything checked', stuck.asked.some((url) => url.indexOf('stuck=1') !== -1));
    check('and the viewer is told where to report it without waiting for a give-up',
        has(stuck.lines, '/__tube/log') && has(stuck.lines, 'https://discord.gg/'));
    check('and says what it waits on, in red', toneOf(stuck.lines, 'waiting: www.youtube.com is not reachable') === 'bad');
    check('a proxy error is shown in red', toneOf(stuck.lines, 'upstream failed on') === 'bad');

    check('a normal start shows nothing in red', handed.lines.every((line) => line.tone !== 'bad'),
        handed.lines.filter((line) => line.tone === 'bad').map((line) => line.text).join(' | '));

    const said = handed.asked.map((url) => decodeURIComponent((/[?&]said=([^&]*)/.exec(url) || [])[1] || '')).join(' ');
    check('its own lines are sent to the service for its log', said.indexOf('tube: boot screen, cobalt 25.lts.30') !== -1
        && said.indexOf(`tube: handing over to ${CONFIG.service}/tv`) !== -1, said.slice(0, 200));

    const echoed = run(script, [{ facts: FACTS, ready: false, waiting: null, next: 1,
        log: [{ seq: 0, what: 'screen', text: '[    0.000000] tube: boot screen, cobalt 25' }] }], 3);
    check('and are not shown twice when the service log brings them back',
        echoed.lines.filter((line) => line.text.indexOf('boot screen, cobalt') !== -1).length === 1);

    // Each failed ask moves the clock 4.5s (its 4s guard, then the 0.5s retry), so 16 turns is about 36s.
    const slow = run(script, [null], 16);
    const dead = run(script, [null], 32);
    check('a slow start is only warned about, not called a failure', slow.lines.some((line) => line.tone === 'warn')
        && slow.lines.every((line) => line.tone !== 'bad'));

    const silent = run(script, [null], 90);
    const minute = run(script, [null], 30);
    check('only after a minute is it told what to do, in red', toneOf(minute.lines, 'still not answering after 60s') === 'bad',
        minute.lines.map((line) => line.text).join(' | '));

    check('it says which build wrote the page, and when', has(handed.lines, `tube: page written 0s ago by service pid ${process.pid}, patch `));
    check('a refused ask is named at once', has(slow.lines, `service: ${host(CONFIG.service)}: refused at once`),
        slow.lines.map((line) => line.text).join(' | '));

    // The diag page is served by the service that just refused, so it would never load.
    check('a refused service is never sent to the page it cannot serve',
        !has(slow.lines, CONFIG.diag) && !has(silent.lines, CONFIG.diag), slow.lines.map((line) => line.text).join(' | '));
    check('a minute of refusals says how to get the service started',
        has(minute.lines, 'hold the power button') || has(minute.lines, 'Hold the power button'),
        minute.lines.map((line) => line.text).join(' | '));

    const advised = (lines) => lines.filter((line) => line.text.indexOf('it shows what failed and what to do') !== -1).length;

    const dropped = run(script, [null], 6, { hang: true });
    check('a service that is there but silent points at the page that explains it', has(dropped.lines, CONFIG.diag),
        dropped.lines.map((line) => line.text).join(' | '));
    check('and once rather than on every retry', advised(run(script, [null], 14, { hang: true }).lines) === 1);
    check('and the other addresses are asked too, without a verdict at first', has(slow.lines, 'service: nor at 127.0.0.1:8099 yet'));
    check('which comes once the silence lasts', has(slow.lines, 'nor at 127.0.0.1:8099: the service is not running, or is stuck'));

    check('a dropped ask is told from a refused one', has(dropped.lines, `service: ${host(CONFIG.service)}: no answer in 4s`));

    const blockedAddress = run(script, [null], 6, { hang: true, elsewhere: 204 });
    check('an address the TV blocks is named at once, in red',
        toneOf(blockedAddress.lines, `answers at 127.0.0.1:8099 but not at ${host(CONFIG.service)}`) === 'bad',
        blockedAddress.lines.map((line) => line.text).join(' | '));
    check('and the screen\'s lines reach the service through the address that works', blockedAddress.asked
        .some((url) => url.indexOf(`${ELSEWHERE}/__tube/boot?`) === 0 && url.indexOf('said=') !== -1), blockedAddress.asked.join(' '));

    const failedOver = run(script, [ready], 16, { hang: true, elsewhere: 204 });
    check('an address that stopped answering is failed over to one that does',
        failedOver.replaced[0] === `${ELSEWHERE}/tv?launch=menu&cert_scope=samsung`,
        failedOver.replaced.join(' ') || failedOver.lines.map((line) => line.text).join(' | '));

    const restarting = run(script, [
        { facts: FACTS, ready: false, waiting: { tone: 'warn', what: 'the service is preparing the certificate' }, next: 1, log: [] },
        { facts: Object.assign({}, FACTS, { pid: 5000 }), ready: false, waiting: { tone: 'warn', what: 'the service is preparing the certificate' },
            next: 2, log: [{ seq: 0, what: 'previous', text: 'uncaught: TypeError: tizen.foo is not a function' },
                { seq: 1, what: 'warning', text: 'DeprecationWarning: Buffer() is deprecated' }] }
    ], 6);

    check('a service that restarts behind the screen is said to, in red', toneOf(restarting.lines, 'restarted: pid 4384 is now pid 5000') === 'bad');
    check('with how its last run ended, in red', toneOf(restarting.lines, 'uncaught: TypeError: tizen.foo') === 'bad');
    check('and node\'s warnings in yellow', toneOf(restarting.lines, 'DeprecationWarning') === 'warn');

    const blocked = run(script, [ready], 80, { probe: 0 });
    check('it never hands over while YouTube does not answer through the service', blocked.replaced.length === 0);
    check('it asks the service to restart the app, once', blocked.asked.filter((url) => url.indexOf('restart=1') !== -1).length === 1);
    check('and in the end says in red what to do', toneOf(blocked.lines, 'youtube still does not answer through the service') === 'bad');

    check('a screen getting nowhere has the service check everything, once',
        blocked.asked.filter((url) => url.indexOf('stuck=1') !== -1).length === 1,
        blocked.asked.filter((url) => url.indexOf('stuck=1') !== -1).join(' '));
    check('and says where to read the whole log', has(blocked.lines, `${CONFIG.journal}`), CONFIG.journal);
    check('and where to report it', has(blocked.lines, 'https://discord.gg/') && has(blocked.lines, 'github.com/SushyDev/tizen-youtube'));
    const quick = run(script, [ready], 6);
    check('a start that answers at once never asks for the deep check',
        quick.asked.every((url) => url.indexOf('stuck=1') === -1), quick.asked.join(' '));

    check('a service that never answers is reported to the Discord, not to its own dead log',
        has(minute.lines, 'https://discord.gg/') && !has(minute.lines, CONFIG.journal),
        minute.lines.map((line) => line.text).join(' | '));
    check('and the checks it could not run are not claimed to have passed',
        silent.lines.every((line) => line.text.indexOf('ok: ') === -1));

    const early = run(script, [null], 4);
    check('a start still under way stays calm on the card', early.card.tone === 'tone-calm'
        && early.card.head === 'Starting Tube' && early.card.steps.length === 0, JSON.stringify(early.card));
    const cold = run(script, [null], 12);
    check('a slow cold start says so calmly before it turns red', cold.card.tone === 'tone-calm'
        && cold.card.head === 'Still starting' && cold.card.steps.length === 0, JSON.stringify(cold.card));
    check('the card always names the build', early.card.version.indexOf('Tube ') === 0, early.card.version);
    check('a normal start never turns the card red', handed.card.tone === 'tone-ok' && handed.card.head === 'Opening YouTube',
        JSON.stringify(handed.card));
    check('and shows the patch the service reports', handed.card.version === 'Tube 1.0.1-abc1234-clean', handed.card.version);
    check('a service that answers but is not ready offers the diag page as a QR code', echoed.card.qr > 0
        && echoed.card.label === 'Scan for help' && echoed.card.tone === 'tone-calm', JSON.stringify(echoed.card));

    check('a service that never answers turns the card into steps', dead.card.tone === 'tone-bad'
        && dead.card.head === 'Tube\'s background service isn\'t running' && dead.card.steps.length === 3,
        JSON.stringify(dead.card));
    check('which suggest Tizen Homebrew as something to try, not a promise',
        dead.card.steps.some((step) => step.indexOf('try opening Tizen Homebrew') !== -1), dead.card.steps.join(' | '));
    check('and without a support bot point at the Discord', dead.card.label === 'Scan to ask on Discord' && dead.card.qr > 0,
        JSON.stringify(dead.card));

    check('a broken connection to YouTube is said plainly on the card', stuck.card.tone === 'tone-bad'
        && stuck.card.head === 'Can\'t reach YouTube' && stuck.card.qr > 0, JSON.stringify(stuck.card));
    check('and so is YouTube not loading through the service', blocked.card.head === 'YouTube doesn\'t load through Tube',
        JSON.stringify(blocked.card));

    const reported = run(script, [null], 32, { support: true });
    const sent = reported.posted[0] || { body: { report: { log: [] } } };
    check('a stuck screen sends its own report, once', reported.posted.length === 1
        && sent.url === 'https://help.example/api/reports' && sent.body.app === 'youtube', JSON.stringify(reported.posted).slice(0, 300));
    check('with the lines it showed', sent.body.report.log.some((line) => line.text.indexOf('refused at once') !== -1));
    check('and shows the code to post, with a QR code of it', reported.card.code === 'K7QF-29XM'
        && reported.card.label === 'Post this code in Discord' && reported.card.qr > 0, JSON.stringify(reported.card));
    check('and says it in the log too', has(reported.lines, 'post code K7QF-29XM'));
    check('a normal start sends nothing', run(script, [ready], 12, { support: true }).posted.length === 0);

    const unsent = run(script, [null], 32, { support: 'down' });
    check('a report that cannot be sent falls back to a photo', has(unsent.lines, 'post a photo of this screen')
        && unsent.card.label === 'Scan to ask on Discord', JSON.stringify(unsent.card));

    check('without storage the page never reads itself again', silent.replaced.length === 0, silent.replaced.join(' '));

    const reread = run(script, [null], 60, { storage: true });
    check('with storage a page nobody answers reads itself again, at most twice',
        reread.replaced.length === 2 && reread.replaced.every((to) => to.indexOf('file:///tube/boot.html?launch=menu') === 0),
        reread.replaced.join(' '));

    const page = html(script);
    const config = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'config.xml'), 'utf8');

    check('the widget starts the container on the boot screen', config.indexOf(`--base_url=${BOOT_URL}`) !== -1);
    check('and carries no --proxy',
        config.indexOf('--proxy=') === -1);
    check('its policy lets it reach the service and go to the page we serve',
        page.indexOf(`connect-src ${CONFIG.service} `) !== -1
        && page.indexOf(`h5vcc-location-src https://www.youtube.com ${CONFIG.service} file:`) !== -1
        && page.indexOf('help.example') === -1,
        (/content="([^"]*)"/.exec(page) || [])[1]);

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tube-boot-'));
    const written = writeBootScreen(scratch, script);
    const undated = (text) => text.replace(/"at":\d+/, '');

    check('it is written where file:///tube/boot.html resolves',
        written === path.join(scratch, 'web', 'tube', 'boot.html') && undated(fs.readFileSync(written, 'utf8')) === undated(page));

    fs.rmSync(scratch, { recursive: true, force: true });
};

bundled().then(checks).catch((error) => check('the page bundles', false, error.stack)).then(() => {
    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
});
