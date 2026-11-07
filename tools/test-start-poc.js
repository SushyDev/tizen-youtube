'use strict';

const assert = require('assert');
const { readFileSync } = require('fs');
const { join } = require('path');
const vm = require('vm');
const acorn = require('acorn');
const JSZip = require('jszip');
const { derive } = require('./package-start-poc.js');
const { ROOT } = require('./lib/config.js');

const results = [];
const check = (name, run) => {
    try { run(); results.push(true); console.log(`PASS  ${name}`); }
    catch (error) { results.push(false); console.error(`FAIL  ${name}: ${error.message}`); }
};

const harness = (script, config, hidden = false) => {
    const events = {};
    const requests = [];
    const launches = [];
    const kills = [];
    const timers = new Map();
    const sequence = { next: 0, exited: 0, now: 0 };
    const doc = { hidden, visibilityState: hidden ? 'hidden' : 'visible', activeElement: null };
    const nodes = {};
    ['status', 'log', 'retry', 'service-only', 'kill', 'diagnose', 'exit'].forEach((id) => {
        nodes[id] = {
            textContent: '', scrollTop: 0, scrollHeight: 0, disabled: id === 'kill',
            focus: () => { doc.activeElement = nodes[id]; },
            click: () => { if (!nodes[id].disabled) nodes[id].onclick(); }
        };
    });
    doc.getElementById = (id) => nodes[id];
    doc.addEventListener = (name, run) => { events[name] = run; };
    const app = { appInfo: { id: config.appId, packageId: config.packageId }, exit: () => { sequence.exited += 1; } };
    const api = {
        getCurrentApplication: () => app,
        launch: (id, ok, error) => launches.push({ id, ok, error }),
        kill: (id, ok, error) => kills.push({ id, ok, error }),
        getAppInfo: () => ({ packageId: config.handoffPackageId }),
        getAppMetaData: () => Object.keys(config.nativeMetadata).map((key) => ({ key, value: config.nativeMetadata[key] })),
        getAppsContext: (done) => done([])
    };
    const page = {
        document: doc, tizen: { application: api },
        setTimeout: (run, delay) => { sequence.next += 1; timers.set(sequence.next, { run, delay }); return sequence.next; },
        clearTimeout: (id) => timers.delete(id),
        XMLHttpRequest: function () {
            this.open = (method, url) => { this.method = method; this.url = url; };
            this.send = () => requests.push(this);
            this.abort = () => { if (this.onabort) this.onabort(); };
        }
    };
    const clockDate = function (...args) { return new Date(...args); };
    clockDate.now = () => sequence.now;
    vm.runInNewContext(script, { window: page, Date: clockDate }, { timeout: 1000 });
    const respond = (status) => {
        const xhr = requests.shift();
        assert(xhr, 'expected a pending XHR');
        assert.strictEqual(xhr.method, 'GET');
        assert(xhr.url.startsWith(config.ping + '?'));
        xhr.status = status;
        xhr.onload();
    };
    const timer = (delay) => {
        const entry = Array.from(timers).find((entry) => entry[1].delay === delay);
        assert(entry, `expected a ${delay}ms timer`);
        timers.delete(entry[0]);
        sequence.now += entry[1].delay;
        entry[1].run();
    };
    const visibility = (hidden) => {
        doc.hidden = hidden;
        doc.visibilityState = hidden ? 'hidden' : 'visible';
        events.visibilitychange();
    };
    const key = (keyCode, repeat = false) => events.keydown({ keyCode, repeat, preventDefault: () => {} });
    return { page, nodes, app, api, requests, launches, kills, timers, sequence, respond, timer, visibility, key };
};

const main = async () => {
    // Build a legacy widget fixture so npm test needs the build, but no pre-existing release archive.
    const fixture = new JSZip();
    const legacyXml = readFileSync(join(ROOT, 'app/config.xml'), 'utf8')
        .replace(/tUb3Xq7Lm9/g, 'tUb3Xq7L50')
        .replace('required_version="5.5"', 'required_version="5.0"')
        .replace('--base_url=file:///tube/boot.html --content=/home/owner/share/tube/cobalt-content',
            '--base_url=http://127.0.0.2:8099/tv');
    fixture.file('config.xml', legacyXml);
    fixture.file('index.html', readFileSync(join(ROOT, 'app/index.html')));
    fixture.file('icon.png', readFileSync(join(ROOT, 'app/icon.png')));
    fixture.file('service/dist/index.js', readFileSync(join(ROOT, 'service/dist-legacy/index.js')));
    fixture.file('author-signature.xml', 'stale signature');
    fixture.file('signature1.xml', 'stale signature');
    const bytes = await fixture.generateAsync({ type: 'nodebuffer' });
    const before = Buffer.from(bytes);
    const { web, native, config } = await derive(bytes);
    const webXml = await web.file('config.xml').async('string');
    const nativeXml = await native.file('config.xml').async('string');
    const html = await web.file('index.html').async('string');
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
    const make = (hidden) => harness(script, config, hidden);
    check('PoC derivation preserves its input archive', () => assert(bytes.equals(before)));
    check('web PoC retains the original package, app and service IDs', () => {
        assert(webXml.includes('id="tUb3Xq7L50.Tube" package="tUb3Xq7L50" required_version="5.0"'));
        assert(webXml.includes('id="tUb3Xq7L50.TubeService" auto-restart="false" on-boot="false"'));
        assert(webXml.includes('metadata/devel.api.version" value="5.0"'));
        assert(webXml.includes('background-support="enable"'));
        assert(webXml.includes('<tizen:privilege name="http://tizen.org/privilege/appmanager.kill"/>'));
        assert(!nativeXml.includes('privilege/appmanager.kill'));
    });
    const starterIcon = await web.file('icon.png').async('nodebuffer');
    const cobaltIcon = await native.file('icon-cobalt.png').async('nodebuffer');
    check('widgets have different names and reference only their own PNG icons', () => {
        assert(webXml.includes('<name>Tube Starter</name>'));
        assert(nativeXml.includes('<name>Tube Cobalt</name>'));
        assert(webXml.includes('<icon src="icon.png"/>'));
        assert(starterIcon.equals(readFileSync(join(ROOT, 'app/icon.png'))));
        assert(nativeXml.includes('<icon src="icon-cobalt.png" width="117" height="117"/>'));
        assert(!starterIcon.equals(cobaltIcon));
        assert.strictEqual(web.file('icon-starter.png'), null);
        assert.strictEqual(native.file('icon.png'), null);
        assert.strictEqual(web.file('icon-cobalt.png'), null);
        assert.strictEqual(native.file('icon-starter.png'), null);
    });
    check('starter keeps the original 512px RGB PNG and handoff keeps its 117px RGBA PNG', () => {
        [starterIcon, cobaltIcon].forEach((png) => {
            assert.strictEqual(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
            assert.strictEqual(png[24], 8);
            assert(png.length < 300 * 1024);
        });
        assert.strictEqual(starterIcon.readUInt32BE(16), 512);
        assert.strictEqual(starterIcon.readUInt32BE(20), 512);
        assert.strictEqual(starterIcon[25], 2);
        assert.strictEqual(cobaltIcon.readUInt32BE(16), 117);
        assert.strictEqual(cobaltIcon.readUInt32BE(20), 117);
        assert.strictEqual(cobaltIcon[25], 6);
    });
    check('web PoC removes native pairing but retains the service origin configuration', () => {
        assert(!webXml.includes('metadata/nativeID"'));
        assert(!webXml.includes('metadata/pkgid"'));
        assert(webXml.includes(config.nativeMetadata['http://samsung.com/tv/metadata/native.userdata']));
    });
    check('handoff has its own app and no service or service files', () => {
        assert(nativeXml.includes(`id="${config.handoffId}" package="${config.handoffPackageId}"`));
        assert(!nativeXml.includes('<tizen:service'));
        assert(!Object.keys(native.files).some((name) => name.startsWith('service/')));
        Object.keys(config.nativeMetadata).forEach((key) => assert(nativeXml.includes(`key="${key}" value="${config.nativeMetadata[key]}"`)));
    });
    check('derived widgets contain no stale signatures', () => {
        [web, native].forEach((zip) => {
            assert.strictEqual(zip.file('author-signature.xml'), null);
            assert.strictEqual(zip.file('signature1.xml'), null);
        });
    });
    const original = await JSZip.loadAsync(bytes);
    const service = await web.file('service/dist/index.js').async('nodebuffer');
    const sourceService = await original.file('service/dist/index.js').async('nodebuffer');
    check('PoC carries the unchanged corrected legacy service', () => assert(service.equals(sourceService)));
    check('serialized TV page parses as ES2017 with no unreplaced token', () => {
        acorn.parse(script, { ecmaVersion: 2017 });
        assert(!html.includes('__TUBE_START_POC_SCRIPT__'));
    });
    const old = { appId: config.nativeId, id: 'cobalt-context-41' };
    const other = { appId: 'unknown.app', id: 'unrelated-7' };
    const found = (tv, list) => { tv.api.getAppsContext = (done) => done(list); };
    const up = (tv, list = []) => {
        found(tv, list);
        tv.respond(204); // Initial service check.
        tv.respond(204); // Revalidate immediately before native launch.
        assert.strictEqual(tv.launches[0].id, config.handoffId);
    };
    const blocked = () => {
        const tv = make(); up(tv, [old, other]);
        tv.launches[0].ok(); tv.timer(3000);
        assert.strictEqual(tv.nodes.kill.disabled, false);
        return tv;
    };
    check('prelaunch is disabled for both generated apps', () => {
        [webXml, nativeXml].forEach((xml) => assert(xml.includes('metadata/prelaunch.support" value="false"')));
    });
    check('hidden prelaunch performs no network request, launch or kill', () => {
        const tv = make(true);
        assert.strictEqual(tv.requests.length + tv.launches.length + tv.kills.length, 0);
        tv.visibility(false); tv.respond(0);
        assert.strictEqual(tv.launches[0].id, config.serviceId);
    });
    check('wrong package identity cannot start a service or handoff', () => {
        const tv = make(true); tv.app.appInfo.packageId = 'other'; tv.visibility(false);
        assert.strictEqual(tv.launches.length, 0);
        assert(tv.nodes.log.textContent.includes('Falscher Aufrufer'));
    });
    check('one opening starts its own service and automatically hands off only after HTTP 204', () => {
        const tv = make(); tv.respond(0);
        assert.strictEqual(tv.launches[0].id, config.serviceId);
        tv.launches[0].ok(); tv.respond(200);
        assert.strictEqual(tv.launches.length, 1);
        tv.timer(500); tv.respond(204); tv.respond(204);
        assert.strictEqual(tv.launches[1].id, config.handoffId);
        found(tv, [old]); tv.launches[1].ok(); tv.timer(3000);
        assert.strictEqual(tv.timers.size, 0);
        assert.strictEqual(tv.kills.length, 0);
    });
    check('an already ready service is never explicitly launched', () => {
        const tv = make(); up(tv); tv.launches[0].ok(); tv.timer(3000);
        assert(tv.launches.every((call) => call.id === config.handoffId));
        assert(tv.nodes.log.textContent.includes('kein Service-Launch erforderlich'));
        assert.strictEqual(tv.launches.length, 1);
    });
    check('service success callback alone does not start Cobalt', () => {
        const tv = make(); tv.respond(0); tv.launches[0].ok();
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.nodes.kill.disabled, true);
    });
    check('service launch errors include contexts and prevent Cobalt', () => {
        const tv = make(); tv.respond(0);
        tv.launches[0].error({ name: 'SecurityError', message: 'denied' });
        assert(tv.nodes.log.textContent.includes('SecurityError: denied'));
        assert(tv.nodes.log.textContent.includes('Kontexte (nach Service-Start Fehler)'));
        assert.strictEqual(tv.timers.size, 0);
        assert.strictEqual(tv.launches.length, 1);
    });
    check('missing callbacks expire at the absolute 30 s deadline and late replies cannot act', () => {
        const tv = make(); tv.respond(0); tv.timer(30000); tv.launches[0].ok();
        assert(tv.nodes.log.textContent.includes('Nach 30 s'));
        assert.strictEqual(tv.requests.length, 0);
        assert.strictEqual(tv.launches.length, 1);
    });
    check('service readiness polling stops after its bounded 20 s window', () => {
        const tv = make(); tv.respond(0); tv.launches[0].ok(); tv.respond(0);
        tv.sequence.now = 20000; tv.timer(500);
        assert.strictEqual(tv.requests.length, 0);
        assert.strictEqual(tv.timers.size, 0);
        assert(tv.nodes.log.textContent.includes('nach 20 s nicht bereit'));
    });
    check('hiding before handoff aborts work and ignores a late ping', () => {
        const tv = make(); tv.respond(0); tv.launches[0].ok();
        tv.visibility(true); tv.respond(204); tv.visibility(false);
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.timers.size, 0);
    });
    check('failed fresh ping prevents handoff even after a successful initial ping', () => {
        const tv = make(); tv.respond(204); tv.respond(0);
        assert.strictEqual(tv.launches.length, 0);
        assert(tv.nodes.log.textContent.includes('Handoff gesperrt'));
    });
    check('missing or mismatching handoff metadata prevents native launch', () => {
        const tv = make(); tv.api.getAppMetaData = () => []; tv.respond(204);
        assert.strictEqual(tv.launches.length, 0);
        assert(tv.nodes.log.textContent.includes('Metadaten passen nicht'));
    });
    check('foreign handoff package is rejected', () => {
        const tv = make(); tv.api.getAppInfo = () => ({ packageId: 'foreign' }); tv.respond(204);
        assert.strictEqual(tv.launches.length, 0);
    });
    check('context query failure prevents launch and is logged', () => {
        const tv = make();
        tv.api.getAppsContext = (done, error) => error({ name: 'UnknownError', message: 'contexts unavailable' });
        tv.respond(204);
        assert.strictEqual(tv.launches.length, 0);
        assert(tv.nodes.log.textContent.includes('contexts unavailable'));
    });
    check('existing Cobalt permits a normal handoff, with exact IDs logged and no automatic kill', () => {
        const tv = blocked();
        assert(tv.nodes.log.textContent.includes(JSON.stringify(old)));
        assert(tv.nodes.log.textContent.includes(JSON.stringify(other)));
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.kills.length, 0);
        assert.strictEqual(tv.timers.size, 0);
        assert(tv.nodes.status.textContent.includes('Wiedergabe am TV prüfen'));
    });
    check('a replaced context prevents a retry without claiming a verified modified session', () => {
        const tv = make(); up(tv, [old]); tv.launches[0].ok();
        found(tv, [{ appId: config.nativeId, id: 'replacement-42' }]); tv.timer(3000);
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.timers.size, 0);
        assert(!tv.nodes.status.textContent.includes('Sitzung erfolgreich'));
    });
    check('disappearing old Cobalt triggers exactly one delayed retry, also in the background', () => {
        const tv = make(); up(tv, [old, other]); tv.visibility(true); tv.launches[0].ok();
        found(tv, [other]); tv.timer(3000); tv.timer(1200); tv.respond(204);
        assert.strictEqual(tv.launches.length, 2);
        tv.launches[1].ok(); tv.timer(3000);
        assert.strictEqual(tv.launches.length, 2);
        assert.strictEqual(tv.kills.length, 0);
        assert.strictEqual(tv.timers.size, 0);
        assert.strictEqual(tv.sequence.exited, 1);
    });
    check('Cobalt returning during the retry delay suppresses the second handoff', () => {
        const tv = make(); up(tv, [old]); tv.launches[0].ok(); found(tv, []); tv.timer(3000);
        found(tv, [old]); tv.timer(1200);
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.requests.length, 0);
    });
    check('no initial Cobalt context means at most one attempt even if none appears', () => {
        const tv = make(); up(tv); tv.launches[0].ok(); tv.timer(3000);
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.timers.size, 0);
        assert.strictEqual(tv.nodes.kill.disabled, true);
    });
    check('launch error still observes context disappearance and permits only the bounded retry', () => {
        const tv = make(); up(tv, [old]);
        tv.launches[0].error({ name: 'UnknownError', message: 'refused' }); found(tv, []);
        tv.timer(3000); tv.timer(1200); tv.respond(204);
        tv.launches[1].error({ name: 'UnknownError', message: 'again' }); tv.timer(3000);
        assert.strictEqual(tv.launches.length, 2);
        assert.strictEqual(tv.kills.length, 0);
        assert(tv.nodes.log.textContent.includes('UnknownError: refused'));
        assert(tv.nodes.log.textContent.includes('Kontexte (nach Handoff 1 Callback)'));
        assert.strictEqual(tv.timers.size, 0);
    });
    check('surviving Cobalt after an error offers cleanup but never retries or kills automatically', () => {
        const tv = make(); up(tv, [old]); tv.launches[0].error({ name: 'SecurityError', message: 'denied' });
        tv.timer(3000);
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.kills.length, 0);
        assert.strictEqual(tv.nodes.kill.disabled, false);
    });
    check('a missing handoff callback times out without retry or kill', () => {
        const tv = make(); up(tv, [old]); tv.timer(30000); tv.launches[0].ok();
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.kills.length, 0);
        assert.strictEqual(tv.timers.size, 0);
    });
    check('a suspended timer cannot launch a stale retry beyond the absolute deadline', () => {
        const tv = make(); up(tv, [old]); tv.launches[0].ok(); found(tv, []);
        tv.sequence.now = 31000; tv.timer(3000);
        assert.strictEqual(tv.launches.length, 1);
        assert(tv.nodes.log.textContent.includes('Zeitfenster abgelaufen'));
    });
    check('duplicate service and handoff callbacks cannot multiply attempts', () => {
        const tv = make(); tv.respond(0); tv.launches[0].ok(); tv.launches[0].ok();
        assert.strictEqual(tv.requests.length, 1);
        tv.respond(204); tv.respond(204); tv.launches[1].ok(); tv.launches[1].ok();
        tv.timer(3000);
        assert.strictEqual(tv.launches.length, 2);
        assert.strictEqual(tv.timers.size, 0);
    });
    check('repeated start button presses during a run do nothing', () => {
        const tv = make(); tv.nodes.retry.click(); up(tv, [old]); tv.nodes.retry.click();
        assert.strictEqual(tv.launches.length, 1);
        tv.launches[0].ok(); tv.timer(3000);
        tv.nodes.retry.click(); tv.respond(204); tv.respond(204);
        assert.strictEqual(tv.launches.length, 2); // Second deliberate start operation.
        assert(tv.nodes.log.textContent.includes('START 2'));
    });
    check('cleanup requires two distinct confirmations and never starts another handoff', () => {
        const tv = blocked(); tv.nodes.kill.click();
        assert.strictEqual(tv.kills.length, 0);
        assert(tv.nodes.status.textContent.includes(old.id));
        assert(tv.nodes.status.textContent.includes('YouTube-Wiedergabe'));
        tv.nodes.kill.click(); assert.strictEqual(tv.kills[0].id, old.id);
        tv.kills[0].ok(); found(tv, [other]); tv.timer(1200);
        assert.strictEqual(tv.launches.length, 1);
        assert(tv.nodes.log.textContent.includes('Zielkontext verschwunden'));
    });
    check('holding remote OK cannot confirm cleanup through repeated keydown events', () => {
        const tv = blocked(); tv.nodes.kill.focus(); tv.key(13); tv.key(13, true);
        assert.strictEqual(tv.kills.length, 0);
        tv.key(13); assert.strictEqual(tv.kills.length, 1);
    });
    check('changed context or a foreign app reusing its ID prevents cleanup', () => {
        const tv = blocked(); tv.nodes.kill.click();
        found(tv, [{ appId: config.nativeId, id: 'replacement-42' }, { appId: other.appId, id: old.id }]);
        tv.nodes.kill.click();
        assert.strictEqual(tv.kills.length, 0);
        assert(tv.nodes.log.textContent.includes('Kill-Ziel hat sich geändert'));
    });
    check('unknown, invalid or ambiguous contexts cannot become cleanup targets', () => {
        [[], [other], [{ appId: config.nativeId, id: '' }], [old, { appId: config.nativeId, id: 'second' }]].forEach((list) => {
            const tv = blocked(); found(tv, list); tv.nodes.kill.click(); tv.nodes.kill.click();
            assert.strictEqual(tv.kills.length, 0);
        });
    });
    check('a foreign app sharing the selected context ID prevents the kill', () => {
        const tv = blocked(); tv.nodes.kill.click(); found(tv, [old, { appId: other.appId, id: old.id }]);
        tv.nodes.kill.click(); assert.strictEqual(tv.kills.length, 0);
    });
    check('cleanup permission error is logged with a snapshot and has no fallback', () => {
        const tv = blocked(); tv.nodes.kill.click(); tv.nodes.kill.click();
        tv.kills[0].error({ name: 'SecurityError', message: 'partner denied', code: 18 });
        assert(tv.nodes.log.textContent.includes('SecurityError: partner denied (code=18)'));
        assert(tv.nodes.log.textContent.includes('Kontexte (nach Kill Fehler)'));
        assert.strictEqual(tv.kills.length, 1);
        assert.strictEqual(tv.launches.length, 1);
    });
    check('hiding disarms cleanup confirmation, and returning does not trigger a new start loop', () => {
        const tv = blocked(); tv.nodes.kill.click(); tv.visibility(true); tv.visibility(false);
        tv.nodes.kill.click();
        assert.strictEqual(tv.kills.length, 0);
        assert.strictEqual(tv.launches.length, 1);
    });
    check('Back cancels pending observation and late callbacks cannot retry', () => {
        const tv = make(); up(tv, [old]); tv.launches[0].ok(); tv.key(10009);
        assert.strictEqual(tv.timers.size, 0);
        assert.strictEqual(tv.sequence.exited, 1);
        tv.launches[0].ok(); assert.strictEqual(tv.launches.length, 1);
    });
    const cold = (list = [old, other]) => {
        const tv = make(); found(tv, list); tv.respond(0);
        assert.strictEqual(tv.launches[0].id, config.serviceId);
        return tv;
    };
    const serviceReady = (tv) => { tv.launches[0].ok(); tv.respond(204); };
    check('explicit service launch plus readiness permits one targeted kill before any handoff', () => {
        const tv = cold(); serviceReady(tv);
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.kills.length, 1);
        assert.strictEqual(tv.kills[0].id, old.id);
        assert(tv.nodes.log.textContent.includes('automatisch nach explizitem Service-Start + HTTP 204'));
        tv.kills[0].ok(); found(tv, [other]); tv.timer(1200);
        assert(tv.nodes.log.textContent.includes('verschwunden'));
        tv.respond(204); assert.strictEqual(tv.launches[1].id, config.handoffId);
        found(tv, [old, other]); tv.launches[1].ok(); tv.timer(3000);
        assert.strictEqual(tv.nodes.kill.disabled, true); // Automatic kill consumed the shared budget.
        assert(tv.nodes.status.textContent.includes('Kill-Budget verbraucht'));
        tv.nodes.kill.click(); tv.nodes.kill.click();
        assert.strictEqual(tv.kills.length, 1);
        assert.strictEqual(tv.timers.size, 0);
    });
    check('failed initial ping alone never permits an automatic kill', () => {
        const tv = cold();
        assert.strictEqual(tv.kills.length, 0);
        tv.launches[0].error({ name: 'SecurityError', message: 'launch denied' });
        tv.launches[0].ok(); // A contradictory late callback cannot establish permission.
        assert.strictEqual(tv.kills.length, 0);
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.requests.length, 0);
    });
    check('accepted service start without readiness never kills, even with Cobalt present', () => {
        const tv = cold(); tv.launches[0].ok(); tv.respond(200);
        assert.strictEqual(tv.kills.length, 0);
        tv.sequence.now = 20000; tv.timer(500);
        assert.strictEqual(tv.kills.length, 0);
        assert.strictEqual(tv.launches.length, 1);
    });
    check('a missing handoff package cannot cause a preventive kill', () => {
        const tv = cold(); tv.api.getAppInfo = () => { throw new Error('not installed'); };
        serviceReady(tv);
        assert.strictEqual(tv.kills.length, 0);
        assert.strictEqual(tv.launches.length, 1);
    });
    check('no native context after explicit service start leads directly to handoff', () => {
        const tv = cold([other]); serviceReady(tv);
        assert.strictEqual(tv.kills.length, 0); tv.respond(204);
        assert.strictEqual(tv.launches[1].id, config.handoffId);
    });
    check('multiple native contexts skip automatic cleanup but preserve normal handoff', () => {
        const tv = cold([old, { appId: config.nativeId, id: 'second' }, other]); serviceReady(tv);
        assert.strictEqual(tv.kills.length, 0); tv.respond(204);
        assert.strictEqual(tv.launches[1].id, config.handoffId);
        assert(tv.nodes.log.textContent.includes('keine eindeutige') || tv.nodes.log.textContent.includes('Keine eindeutige'));
    });
    check('automatic kill verifies the same context again immediately before invoking the API', () => {
        const tv = cold();
        const snapshots = { number: 0 };
        tv.api.getAppsContext = (done) => {
            snapshots.number += 1;
            // after Service-Start, kill selection, and immediate pre-kill verification
            done(snapshots.number < 3 ? [old, other] : [{ appId: config.nativeId, id: 'changed' }, other]);
        };
        serviceReady(tv);
        assert.strictEqual(tv.kills.length, 0); tv.respond(204);
        assert.strictEqual(tv.launches[1].id, config.handoffId);
        assert(tv.nodes.log.textContent.includes('Kill-Ziel hat sich geändert'));
    });
    check('foreign context ID collision prevents automatic cleanup', () => {
        const tv = cold([old, { appId: other.appId, id: old.id }]); serviceReady(tv);
        assert.strictEqual(tv.kills.length, 0);
        tv.respond(204); assert.strictEqual(tv.launches[1].id, config.handoffId);
    });
    check('automatic kill success callback alone is insufficient while target is still present', () => {
        const tv = cold(); serviceReady(tv); tv.kills[0].ok(); tv.timer(1200);
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.kills.length, 1);
        assert.strictEqual(tv.requests.length, 0);
        assert.strictEqual(tv.timers.size, 0);
        assert(tv.nodes.log.textContent.includes('Zielkontext weiterhin vorhanden'));
    });
    check('automatic kill permission errors stop the operation without handoff or fallback', () => {
        const tv = cold(); serviceReady(tv);
        tv.kills[0].error({ name: 'SecurityError', message: 'partner denied' });
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.kills.length, 1);
        assert.strictEqual(tv.timers.size, 0);
        assert(tv.nodes.log.textContent.includes('partner denied'));
    });
    check('missing kill callback and late success cannot start a handoff', () => {
        const tv = cold(); serviceReady(tv); tv.timer(30000); tv.kills[0].ok();
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.kills.length, 1);
        assert.strictEqual(tv.timers.size, 0);
    });
    check('hiding during automatic cleanup cancels follow-up actions without a second kill', () => {
        const tv = cold(); serviceReady(tv); tv.visibility(true); tv.kills[0].ok();
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.kills.length, 1);
        assert.strictEqual(tv.timers.size, 0);
    });
    check('the manual kill budget is also one per start, including a failed API attempt', () => {
        const tv = blocked(); tv.nodes.kill.click(); tv.nodes.kill.click();
        tv.kills[0].error({ name: 'SecurityError', message: 'denied' });
        tv.nodes.kill.click(); tv.nodes.kill.click();
        assert.strictEqual(tv.kills.length, 1);
        assert.strictEqual(tv.nodes.kill.disabled, true);
    });
    check('automatic kill and a replacement Cobalt context still allow at most two handoffs', () => {
        const tv = cold(); serviceReady(tv); tv.kills[0].ok();
        const replacement = { appId: config.nativeId, id: 'replacement-after-kill' };
        found(tv, [replacement, other]); tv.timer(1200); tv.respond(204); tv.launches[1].ok();
        found(tv, [other]); tv.timer(3000); tv.timer(1200); tv.respond(204);
        tv.launches[2].ok(); tv.timer(3000);
        assert.strictEqual(tv.kills.length, 1);
        assert.strictEqual(tv.launches.filter(one => one.id === config.handoffId).length, 2);
        assert.strictEqual(tv.timers.size, 0);
    });
    check('isolated service diagnostic preserves the successful service-only PoC path', () => {
        const tv = make(); tv.nodes.diagnose.click(); tv.respond(0);
        found(tv, [old, other]); tv.nodes['service-only'].click(); tv.respond(0);
        tv.launches[0].ok(); tv.respond(204);
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.launches[0].id, config.serviceId);
        assert.strictEqual(tv.kills.length, 0);
        assert.strictEqual(tv.timers.size, 0);
        assert(tv.nodes.status.textContent.includes('DIENST OK'));
    });
    check('service-only diagnostic succeeds with HTTP 204 even without the handoff installed', () => {
        const tv = make(); tv.nodes.diagnose.click(); tv.respond(0);
        tv.api.getAppInfo = () => { throw new Error('not installed'); };
        tv.nodes['service-only'].click(); tv.respond(204);
        assert.strictEqual(tv.launches.length, 0);
        assert.strictEqual(tv.kills.length, 0);
        assert(tv.nodes.status.textContent.includes('DIENST OK'));
    });
    check('diagnostic view cancels the start and late callbacks cannot hand off', () => {
        const tv = make(); tv.nodes.diagnose.click(); tv.respond(204);
        assert.strictEqual(tv.launches.length, 0);
        assert.strictEqual(tv.timers.size, 0);
        assert(tv.nodes.status.textContent.includes('Diagnoseansicht'));
    });
    check('duplicate cleanup callbacks cannot create further timers or launches', () => {
        const tv = blocked(); tv.nodes.kill.click(); tv.nodes.kill.click();
        tv.kills[0].ok(); tv.kills[0].ok(); tv.kills[0].error({ name: 'UnknownError', message: 'late' });
        tv.timer(1200);
        assert.strictEqual(tv.timers.size, 0);
        assert.strictEqual(tv.launches.length, 1);
        assert.strictEqual(tv.kills.length, 1);
    });
    check('remote arrows move focus, Up/Down scroll the log, and Back exits', () => {
        const tv = blocked(); tv.nodes.diagnose.focus(); tv.key(37);
        assert.strictEqual(tv.page.document.activeElement, tv.nodes.kill);
        tv.nodes.retry.focus(); tv.key(39); tv.key(40); tv.key(38); tv.key(10009);
        assert.strictEqual(tv.nodes.log.scrollTop, 0);
        assert.strictEqual(tv.sequence.exited, 1);
    });
    console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed.`);
    process.exitCode = results.every(Boolean) ? 0 : 1;
};
main().catch((error) => { console.error(error); process.exitCode = 1; });
