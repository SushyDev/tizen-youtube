'use strict';

// Writes the boot screen where Cobalt's file:// resolves.

const fs = require('fs');
const path = require('path');

const ports = require('./ports.js');
const { SCREEN } = require('./pageLines.js');

const BOOT_URL = 'file:///tube/boot.html';

// file:// resolves against <content>/web.
const RELATIVE = path.join('web', 'tube', 'boot.html');

const SERVICE = `http://127.0.0.2:${ports.PROXY}`;
const YOUTUBE = 'https://www.youtube.com';

const CONFIG = { service: SERVICE, target: `${YOUTUBE}/tv`, probeUrl: `${YOUTUBE}/__tube/ping`, screen: SCREEN };

// Cobalt refuses whatever the policy omits, navigation included.
const POLICY = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; `
    + `connect-src ${SERVICE} ${YOUTUBE}; h5vcc-location-src ${YOUTUBE}`;

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

// Built by rollup from service/boot/.
const ASSET = 'bootScreen.js';
const PLACES = [path.join(__dirname, 'assets'), path.join(__dirname, '..', 'dist', 'assets')];

const pageScript = () => {
    const found = PLACES.map((place) => path.join(place, ASSET)).find((file) => fs.existsSync(file));
    if (!found) throw new Error(`no ${ASSET} among the service's assets`);

    return fs.readFileSync(found, 'utf8');
};

const html = (script) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${POLICY}">
<title>YouTube</title>
<style>
${STYLE}
</style>
</head>
<body>
<div id="log"></div>
<script>window.TUBE_BOOT = ${JSON.stringify(CONFIG)};</script>
<script>
${script}
</script>
</body>
</html>
`;

const writeBootScreen = (content, script) => {
    const file = path.join(content, RELATIVE);

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html(script || pageScript()));

    return file;
};

module.exports = { BOOT_URL, html, writeBootScreen };
