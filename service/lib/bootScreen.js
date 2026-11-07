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

const configFor = (served) => {
    const service = served || origin(serviceAddress());

    return {
        service,
        // A page the service sends has nowhere else to look: it only loaded because this address answered.
        alternates: served ? [] : alternates(),
        // Served by us rather than fetched from YouTube: there is no proxy to intercept the real host.
        target: `${service}/tv`,
        probeUrl: `${service}/__tube/ping`,
        screen: SCREEN,
        journal: onTheLan('/__tube/log'),
        diag: onTheLan('/diag'),
        help: HELP,
        supportUrl: SUPPORT_URL,
        written: { at: Date.now(), patch: STAMP, pid: process.pid }
    };
};

// Cobalt refuses whatever the policy omits, navigation included.
// file: lets the page read itself again after the service rewrote it for a new address, and load trail.js.
const policyFor = (config) => `default-src 'none'; script-src 'unsafe-inline' file:; style-src 'unsafe-inline'; `
    + `connect-src ${[config.service].concat(config.alternates).join(' ')} ${YOUTUBE}`
    + `${config.supportUrl ? ` ${config.supportUrl}` : ''}; `
    + `h5vcc-location-src ${YOUTUBE} ${config.service} file:`;

// Cobalt lays out blocks and absolute boxes but has no flexbox, grid, outline, dashed borders or form elements.
const STYLE = `html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background-color: #000000; }
body { color: #f2f2f2; font-family: sans-serif; font-size: 30px; }
#card, #logs { position: absolute; left: 5%; right: 5%; top: 6%; bottom: 6%; }
#version { font-size: 1.2em; font-weight: bold; }
#platform { position: absolute; right: 0; top: 0; color: #a3a3a3; font-size: 1.1em; }
#left { position: absolute; left: 0; width: 46%; top: 13%; }
#right { position: absolute; left: 54%; right: 0; top: 13%; }
#state { font-size: 2em; line-height: 1.2em; font-weight: bold; }
.check { position: relative; padding-left: 1.5em; margin-top: 0.6em; }
.dot { position: absolute; left: 0; top: 0.5em; width: 0.7em; height: 0.7em; border-radius: 0.35em; }
.check-ok .dot { background-color: #6fb1ff; }
.check-pending .dot { width: 0.5em; height: 0.5em; border: 0.1em solid #f2f2f2; }
.check-idle .dot { width: 0.5em; height: 0.5em; border: 0.1em solid #6a6a6a; }
.check-bad .dot { background-color: #ffa94d; border-radius: 0; }
.name { font-size: 1.3em; line-height: 1.35em; }
.text { font-size: 1em; line-height: 1.35em; color: #a3a3a3; }
.check-idle .name { color: #a3a3a3; }
.check-bad .text { color: #ffc48a; }
#detail { font-size: 1.1em; line-height: 1.45em; color: #c8c8c8; margin-top: 0.9em; }
.step { font-size: 1em; line-height: 1.4em; color: #f2f2f2; margin-top: 0.35em; }
.button { position: relative; font-size: 1.3em; line-height: 1.4em; padding: 0.4em 0.9em; margin-bottom: 0.5em;
    border: 0.08em solid #6a6a6a; border-radius: 0.25em; }
.button.primary { font-size: 1.5em; font-weight: bold; }
.button.off { color: #8c8c8c; border-color: #333333; }
.button.focus { background-color: #ffffff; border-color: #ffffff; color: #000000; }
.value { position: absolute; right: 0.9em; top: 0.4em; font-weight: bold; }
.sub { display: inline; font-size: 0.65em; font-weight: normal; }
#hint { font-size: 1em; line-height: 1.4em; color: #a3a3a3; }
#aside { margin-top: 1em; }
#aside-label { font-size: 1em; line-height: 1.4em; }
#aside-code { font-size: 1.6em; line-height: 1.4em; font-weight: bold; color: #ffff55; }
#qr { position: relative; display: none; margin-top: 0.4em; background-color: #ffffff; }
.m { position: absolute; background-color: #000000; }
#aside-url { font-size: 0.9em; line-height: 1.4em; color: #a3a3a3; font-family: monospace; }
#logs { display: none; }
#logs-head { font-size: 1.2em; line-height: 1.4em; color: #a3a3a3; }
#log { margin-top: 0.6em; white-space: pre; font-family: monospace; font-size: 0.6em; line-height: 1.5em; color: #aaaaaa; }
.t { color: #00aa00; }
.s { color: #aa5500; }
.ok { color: #55ff55; }
.warn { color: #ffff55; }
.bad { color: #ff5555; }
.note { color: #55ffff; }`;

const CARD = `<div id="card" class="tone-calm">
<div id="version"></div><div id="platform"></div>
<div id="left"><div id="state"></div><div id="checks"></div><div id="detail"></div><div id="steps"></div></div>
<div id="right"><div id="buttons"></div><div id="hint"></div>
<div id="aside"><div id="aside-label"></div><div id="aside-code"></div><div id="qr"></div><div id="aside-url"></div></div></div>
</div>
<div id="logs"><div id="logs-head"></div><div id="log"></div></div>`;

const page = (script, config, served) => `<!DOCTYPE html>
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
${served ? '' : '<script src="trail.js"></script>\n'}<script>window.TUBE_BOOT = ${JSON.stringify(config)};</script>
<script>
${script}
</script>
</body>
</html>
`;

// options.origin: the page is sent by the service over http instead of written for Cobalt to read as a file.
const html = (script, options) => {
    const served = options && options.origin;
    return page(script, configFor(served), served);
};

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
