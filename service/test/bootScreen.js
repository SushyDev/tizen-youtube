'use strict';

// The boot screen a container shows while the service starts, bundled from service/boot/ and run
// against a stand-in page.

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

// Only as much of a page as the boot screen touches; replies[] answers each ask in turn.
const run = (script, replies, turns, options) => {
    const probeStatus = options && options.probe !== undefined ? options.probe : 204;
    const elsewhereStatus = options && options.elsewhere !== undefined ? options.elsewhere : 0;
    const hangs = !!(options && options.hang);
    const answered = { count: 0 };
    const node = () => ({ className: '', textContent: '', kids: [], appendChild(kid) { this.kids.push(kid); } });
    const log = {
        childNodes: [],
        appendChild(line) { this.childNodes.push(line); },
        removeChild(line) { this.childNodes.splice(this.childNodes.indexOf(line), 1); }
    };
    const timers = [];
    const asked = [];
    const replaced = [];
    const clock = { now: 0 };

    function XMLHttpRequest() {}
    XMLHttpRequest.prototype.open = function open(method, url) { this.url = url; };
    XMLHttpRequest.prototype.abort = function abort() {};
    XMLHttpRequest.prototype.send = function send() {
        asked.push(this.url);
        this.readyState = 4;

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
        document: { getElementById: () => log, createElement: node },
        navigator: { userAgent: AGENT },
        XMLHttpRequest,
        setTimeout: (act, delay) => timers.push({ act, delay: delay || 0 }),
        window: {
            TUBE_BOOT: CONFIG,
            performance: { now: () => clock.now },
            innerWidth: 1920,
            innerHeight: 1080,
            devicePixelRatio: 1,
            location: { search: '?launch=menu&cert_scope=samsung', hash: '', replace: (to) => replaced.push(to) }
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

    return { lines, asked, replaced };
};

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
    check('it says when the service answers', has(handed.lines, 'service: answering after'));
    check('it prints the Patch stamp Settings shows', has(handed.lines, 'tube: patch 1.0.1-abc1234-clean'));
    check('and the Tizen version, model and node', has(handed.lines, 'platform: tizen 9.0, QE65S93DATXXN')
        && has(handed.lines, 'service: node v18.18.2, pid 4384'));
    check('it shows the service log in its own colours', toneOf(handed.lines, 'listening: 0.0.0.0:8099') === 'ok');
    const boots = handed.asked.filter((url) => url.indexOf('/__tube/boot?') !== -1);
    check('it tells the service how long it waited, once', boots.filter((url) => url.indexOf('waited=') !== -1).length === 3
        && boots.slice(3).every((url) => url.indexOf('waited=') === -1), boots.join(' '));
    check('it hands over to YouTube with its own query', handed.replaced[0] === 'https://www.youtube.com/tv?launch=menu&cert_scope=samsung',
        handed.replaced.join(' '));
    check('before handing over it asks YouTube through Cobalt\'s proxy',
        handed.asked.some((url) => url.indexOf('https://www.youtube.com/__tube/ping?') === 0));

    const stuck = run(script, [{
        facts: FACTS, ready: false, next: 0, log: [{ seq: 0, what: 'upstream', text: 'upstream failed on https://www.youtube.com/tv: ENOTFOUND' }],
        waiting: { tone: 'bad', what: 'www.youtube.com is not reachable from the TV (ENOTFOUND)' }
    }], 12);

    check('a broken start stays on the log', stuck.replaced.length === 0);
    check('and says what it waits on, in red', toneOf(stuck.lines, 'waiting: www.youtube.com is not reachable') === 'bad');
    check('a proxy error is shown in red', toneOf(stuck.lines, 'upstream failed on') === 'bad');

    check('a normal start shows nothing in red', handed.lines.every((line) => line.tone !== 'bad'),
        handed.lines.filter((line) => line.tone === 'bad').map((line) => line.text).join(' | '));

    const said = handed.asked.map((url) => decodeURIComponent((/[?&]said=([^&]*)/.exec(url) || [])[1] || '')).join(' ');
    check('its own lines are sent to the service for its log', said.indexOf('tube: boot screen, cobalt 25.lts.30') !== -1
        && said.indexOf('tube: handing over to https://www.youtube.com/tv') !== -1, said.slice(0, 200));

    const echoed = run(script, [{ facts: FACTS, ready: false, waiting: null, next: 1,
        log: [{ seq: 0, what: 'screen', text: '[    0.000000] tube: boot screen, cobalt 25' }] }], 3);
    check('and are not shown twice when the service log brings them back',
        echoed.lines.filter((line) => line.text.indexOf('boot screen, cobalt') !== -1).length === 1);

    // Each failed ask moves the clock 4.5s (its 4s guard, then the 0.5s retry), so 16 turns is about 36s.
    const slow = run(script, [null], 16);
    check('a slow start is only warned about, not called a failure', slow.lines.some((line) => line.tone === 'warn')
        && slow.lines.every((line) => line.tone !== 'bad'));

    const silent = run(script, [null], 90);
    check('only after a minute is it told what to do, in red', toneOf(silent.lines, 'still not answering after 60s') === 'bad');

    check('it says which build wrote the page, and when', has(handed.lines, `tube: page written 0s ago by service pid ${process.pid}, patch `));
    check('a refused ask is named at once', has(slow.lines, 'service: 127.0.0.2:8099: refused at once'));
    check('and the other addresses are asked too, without a verdict at first', has(slow.lines, 'service: nor at 127.0.0.1:8099 yet'));
    check('which comes once the silence lasts', has(slow.lines, 'nor at 127.0.0.1:8099: the service is not running, or is stuck'));

    const dropped = run(script, [null], 6, { hang: true });
    check('a dropped ask is told from a refused one', has(dropped.lines, 'service: 127.0.0.2:8099: no answer in 4s'));

    const blockedAddress = run(script, [null], 6, { hang: true, elsewhere: 204 });
    check('an address the TV blocks is named at once, in red',
        toneOf(blockedAddress.lines, 'answers at 127.0.0.1:8099 but not at 127.0.0.2:8099') === 'bad');
    check('and the screen\'s lines reach the service through the address that works', blockedAddress.asked
        .some((url) => url.indexOf(`${ELSEWHERE}/__tube/boot?`) === 0 && url.indexOf('said=') !== -1), blockedAddress.asked.join(' '));

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

    const page = html(script);
    const config = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'config.xml'), 'utf8');

    check('the widget starts the container on the boot screen', config.indexOf(`--base_url=${BOOT_URL}`) !== -1);
    check('its policy lets it reach the service, its other addresses and YouTube, and go there',
        /connect-src http:\/\/127\.0\.0\.2:8099 http:\/\/127\.0\.0\.1:8099 [^;]*https:\/\/www\.youtube\.com;/.test(page)
        && /h5vcc-location-src https:\/\/www\.youtube\.com/.test(page));

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
