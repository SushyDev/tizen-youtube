'use strict';

const fs = require('fs');
const path = require('path');

const ports = require('./ports.js');
const { lanAddresses, serviceAddress } = require('./serviceAddress.js');
const { SCREEN } = require('./pageLines.js');
const { STAMP } = require('./stamp.js');
const { DISCORD, REPO } = require('./links.js');
const { SUPPORT_URL } = require('./support.js');
const { BOOT_PAGE, read } = require('./shipped.js');

const BOOT_URL = 'file:///tube/boot.html';

// file:// resolves against <content>/web.
const RELATIVE = path.join('web', 'tube', 'boot.html');

const YOUTUBE = 'https://www.youtube.com';

const origin = (address) => `http://${address}:${ports.PROXY}`;

// Tried when the chosen address does not answer, to tell a blocked address from a dead service.
const alternates = () => ['127.0.0.1'].concat(lanAddresses())
    .filter((address) => address !== serviceAddress())
    .map(origin);

const HELP = { discord: DISCORD, repo: REPO };

// The viewer reads these on a phone, where loopback is useless.
const onTheLan = (route) => `http://${lanAddresses()[0] || '127.0.0.1'}:${ports.PROXY}${route}`;

const configFor = () => ({
    service: origin(serviceAddress()),
    alternates: alternates(),
    // Served by us rather than fetched from YouTube: there is no proxy to intercept the real host.
    target: `${origin(serviceAddress())}/tv`,
    probeUrl: `${origin(serviceAddress())}/__tube/ping`,
    screen: SCREEN,
    journal: onTheLan('/__tube/log'),
    diag: onTheLan('/diag'),
    help: HELP,
    supportUrl: SUPPORT_URL,
    written: { at: Date.now(), patch: STAMP, pid: process.pid }
});

// Cobalt refuses whatever the policy omits, navigation included.
// file: lets the page read itself again after the service rewrote it for a new address.
const policyFor = (config) => `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; `
    + `connect-src ${[config.service].concat(config.alternates).join(' ')} ${YOUTUBE}`
    + `${config.supportUrl ? ` ${config.supportUrl}` : ''}; `
    + `h5vcc-location-src ${YOUTUBE} ${config.service} file:`;

const STYLE = `html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background-color: #000000; }
body { color: #aaaaaa; font-family: monospace; font-size: 17px; line-height: 26px; }
#card { position: absolute; left: 24px; right: 24px; top: 20px; height: 400px; background-color: #101418;
    border-left: 6px solid #4a6a80; }
#card.tone-bad { border-left-color: #ff5555; background-color: #1c1012; }
#card.tone-ok { border-left-color: #55ff55; }
#main { position: absolute; left: 32px; top: 24px; right: 420px; }
#version { position: absolute; right: 20px; top: 14px; color: #dddddd; font-size: 22px; }
#state { color: #ffffff; font-family: sans-serif; font-size: 40px; line-height: 52px; font-weight: bold; }
#detail { color: #cccccc; font-family: sans-serif; font-size: 24px; line-height: 34px; margin-top: 8px; }
#steps { margin-top: 18px; }
.step { color: #ffffff; font-family: sans-serif; font-size: 22px; line-height: 32px; margin-top: 6px; }
#aside { position: absolute; right: 20px; top: 44px; width: 340px; text-align: center; }
#aside-label { color: #ffffff; font-family: sans-serif; font-size: 22px; line-height: 30px; }
#aside-code { color: #ffff55; font-size: 44px; line-height: 56px; font-weight: bold; letter-spacing: 4px; }
#qr { position: relative; display: none; margin: 8px auto 0 auto; background-color: #ffffff; }
.m { position: absolute; background-color: #000000; }
#aside-url { color: #aaaaaa; font-size: 17px; line-height: 24px; margin-top: 6px; }
#log { position: absolute; left: 24px; right: 24px; top: 436px; white-space: pre; }
.t { color: #00aa00; }
.s { color: #aa5500; }
.ok { color: #55ff55; }
.warn { color: #ffff55; }
.bad { color: #ff5555; }
.note { color: #55ffff; }`;

const CARD = `<div id="card" class="tone-calm">
<div id="version"></div>
<div id="main"><div id="state"></div><div id="detail"></div><div id="steps"></div></div>
<div id="aside"><div id="aside-label"></div><div id="aside-code"></div><div id="qr"></div><div id="aside-url"></div></div>
</div>`;

const page = (script, config) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policyFor(config)}">
<title>YouTube</title>
<style>
${STYLE}
</style>
</head>
<body>
${CARD}
<div id="log"></div>
<script>window.TUBE_BOOT = ${JSON.stringify(config)};</script>
<script>
${script}
</script>
</body>
</html>
`;

const html = (script) => page(script, configFor());

// Renamed into place, so a container starting meanwhile never reads half a page.
const writeBootScreen = (content, script) => {
    const file = path.join(content, RELATIVE);
    const staged = `${file}.${process.pid}`;

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(staged, html(script || read(BOOT_PAGE)));
    fs.renameSync(staged, file);

    return file;
};

module.exports = { BOOT_URL, html, writeBootScreen };
