'use strict';

// Writes the boot screen where Cobalt's file:// resolves.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ports = require('./ports.js');
const { SCREEN } = require('./pageLines.js');
const { STAMP } = require('./stamp.js');
const { DISCORD, REPO } = require('./links.js');
const { BOOT_PAGE, read } = require('./shipped.js');

const BOOT_URL = 'file:///tube/boot.html';

// file:// resolves against <content>/web.
const RELATIVE = path.join('web', 'tube', 'boot.html');

const SERVICE = `http://127.0.0.2:${ports.PROXY}`;
const YOUTUBE = 'https://www.youtube.com';

// node 18.0 to 18.3 name the family 4.
const lanAddresses = () => {
    const interfaces = os.networkInterfaces();

    return Object.keys(interfaces).reduce((all, device) => all.concat(interfaces[device]
        .filter((entry) => !entry.internal && (entry.family === 'IPv4' || entry.family === 4))
        .map((entry) => entry.address)), []);
};

// Tried when the switch's address does not answer, to tell a blocked address from a dead service.
const alternates = () => ['127.0.0.1'].concat(lanAddresses()).map((address) => `http://${address}:${ports.PROXY}`);

const HELP = { discord: DISCORD, repo: REPO };

// A LAN address, because the viewer reads this one on a phone and loopback is useless off the set.
const journal = () => `http://${lanAddresses()[0] || '127.0.0.1'}:${ports.PROXY}/__tube/log`;

const configFor = () => ({
    service: SERVICE,
    alternates: alternates(),
    target: `${YOUTUBE}/tv`,
    probeUrl: `${YOUTUBE}/__tube/ping`,
    screen: SCREEN,
    journal: journal(),
    help: HELP,
    written: { at: Date.now(), patch: STAMP, pid: process.pid }
});

// Cobalt refuses whatever the policy omits, navigation included.
const policyFor = (config) => `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; `
    + `connect-src ${[config.service].concat(config.alternates).join(' ')} ${YOUTUBE}; h5vcc-location-src ${YOUTUBE}`;

// The old boot screen's palette.
const STYLE = `html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background-color: #000000; }
body { color: #aaaaaa; font-family: monospace; font-size: 19px; line-height: 29px; }
#log { position: absolute; left: 24px; right: 24px; top: 16px; white-space: pre; }
.t { color: #00aa00; }
.s { color: #aa5500; }
.ok { color: #55ff55; }
.warn { color: #ffff55; }
.bad { color: #ff5555; }
.note { color: #55ffff; }`;

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
