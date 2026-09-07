'use strict';

// What Cobalt's engine can actually do, measured on the set instead of guessed from a version.
//
//   node tools/engine-probe.js                       print the snippet to paste
//   node tools/engine-probe.js --host 192.168.1.107  run it through that set's dev bridge

const http = require('http');

const ui = require('./report.js');
const { DEV } = require('../service/lib/ports.js');

const asJson = (text) => {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
};

// Named so the reply reads as a table rather than a list of booleans.
const PROBE = `(function () {
    var has = {
        'flat (Chrome 69)': typeof [].flat === 'function',
        'flatMap (Chrome 69)': typeof [].flatMap === 'function',
        'Object.fromEntries (Chrome 73)': typeof Object.fromEntries === 'function',
        'String.matchAll (Chrome 73)': typeof ''.matchAll === 'function',
        'globalThis (Chrome 71)': typeof globalThis !== 'undefined',
        'Promise.allSettled (Chrome 76)': typeof Promise.allSettled === 'function',
        'String.replaceAll (Chrome 85)': typeof ''.replaceAll === 'function',
        'Promise.any (Chrome 85)': typeof Promise.any === 'function',
        'Array.at (Chrome 92)': typeof [].at === 'function',
        'Object.hasOwn (Chrome 93)': typeof Object.hasOwn === 'function',
        'optional chaining (Chrome 80)': (function () {
            try { return eval('({a:1})?.a') === 1; } catch (e) { return false; }
        }()),
        'class fields (Chrome 74)': (function () {
            try { return eval('(class { #x = 1; get() { return this.#x; } })') && true; } catch (e) { return false; }
        }())
    };

    return { agent: navigator.userAgent, has: has };
}())`;

const args = process.argv.slice(2);
const hostAt = args.indexOf('--host');
const tokenAt = args.indexOf('--token');
const host = hostAt === -1 ? null : args[hostAt + 1];
const token = tokenAt === -1 ? '' : args[tokenAt + 1];

if (!host) {
    ui.heading('engine probe', 'paste this into the set');
    ui.note('Run it through the dev bridge, or any console you can reach the page with:');
    ui.blank();
    process.stdout.write(`${PROBE}\n\n`);
    ui.note('Or point it at a set directly:  node tools/engine-probe.js --host 192.168.1.107');
    ui.blank();
    process.exit(0);
}

const request = http.request({
    host,
    port: DEV,
    path: '/eval?seconds=20',
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'x-tube-token': token }
}, (response) => {
    const held = { parts: [] };
    response.on('data', (chunk) => { held.parts = held.parts.concat([chunk]); });
    response.on('end', () => {
        const body = Buffer.concat(held.parts).toString('utf8');

        const answer = asJson(body);

        if (!answer) return ui.crash(new Error(`${host} did not answer JSON: ${body.slice(0, 200)}`));
        if (answer.error) return ui.crash(Object.assign(new Error(answer.error), { isFriendly: true }));

        const value = asJson(answer.value);

        if (!value) return ui.crash(new Error(`could not read the reply: ${String(answer.value).slice(0, 200)}`));

        ui.heading('engine probe', host);
        ui.note(value.agent);
        ui.blank();

        Object.keys(value.has).forEach((name) => {
            if (value.has[name]) ui.ok(name, 'present');
            else ui.warn(`${name} — absent`);
        });

        ui.blank();
        ui.note('Everything present here is safe to remove from SINCE.cobalt3 in tools/check-output.js,');
        ui.note('and the Babel target in mods/rollup.config.js can rise to match.');
        ui.blank();
        return undefined;
    });
});

request.on('error', (error) => ui.crash(Object.assign(
    new Error(`could not reach the dev bridge on ${host}:${DEV} — ${error.message}\n\n`
        + '  It only listens in a TUBE_DEV=1 build with diagnostics switched on.'),
    { isFriendly: true }
)));

request.end(PROBE);
