'use strict';

// Opened from a LAN that may have no route to the internet, so nothing is fetched and the plain
// elements carry the page.

const os = require('os');

const ports = require('./ports.js');
const { STAMP } = require('./stamp.js');
const { DISCORD, REPO } = require('./links.js');
const { facts } = require('./platform.js');
const { checks } = require('./diagnosis.js');
const containerAgent = require('./containerAgent.js');

const escaped = (value) => String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// "null" on a diagnostics page reads as a fault rather than a blank.
const shown = (value) => (value === null || value === undefined || value === '' ? 'not readable here' : value);

const seconds = () => Math.round(process.uptime());

const worded = (count) => {
    if (count < 120) return `${count}s`;

    return count < 7200 ? `${Math.round(count / 60)}m` : `${Math.round(count / 3600)}h`;
};

const item = (found) => `<li class="${found.ok ? 'ok' : 'bad'}">`
    + (found.ok ? '' : '<strong>FAILED</strong> ')
    + `<b>${escaped(found.name)}</b> — <code>${escaped(found.detail)}</code></li>`;

// The address the phone already reached us on, so the log link works from the same network.
const at = (host) => `http://${(host || 'localhost').replace(/:\d+$/, '')}:${ports.PROXY}`;

// The LAN address is the thing a viewer is asked for and cannot find.
const onTheNetwork = () => {
    const interfaces = os.networkInterfaces();

    return Object.keys(interfaces).reduce((all, device) => all.concat(interfaces[device]
        .filter((entry) => !entry.internal && entry.family === 'IPv4')
        .map((entry) => entry.address)), []).join(', ');
};

// Shared with the app info panel on the TV itself, not just this phone-facing page.
const thisTvRows = (host) => {
    const known = facts(null);

    return [
        { key: 'Tizen', value: shown(known.tizen) },
        { key: 'Firmware', value: shown(known.firmware) },
        { key: 'Built', value: shown(known.built) },
        { key: 'Model', value: shown(known.model) },
        { key: 'App', value: shown(known.app) },
        { key: 'Container', value: shown(containerAgent.engine()) },
        { key: 'Platform build', value: shown(containerAgent.build()) },
        { key: 'Node', value: shown(known.node) },
        { key: 'Service', value: `pid ${known.pid}, up ${worded(seconds())}`, pid: known.pid, upFor: seconds() },
        { key: 'Host', value: shown(os.hostname()) },
        { key: 'Address', value: shown(at(host)) },
        { key: 'On the network', value: shown(onTheNetwork()) },
        { key: 'User agent', value: shown(containerAgent.agent()) }
    ];
};

// The service row alone carries a machine-readable duration, so it is the one row not just escaped whole.
const pair = (row) => `<dt>${escaped(row.key)}</dt><dd>${
    typeof row.upFor === 'number'
        ? `pid ${escaped(row.pid)}, up <time datetime="PT${row.upFor}S">${escaped(worded(row.upFor))}</time>`
        : escaped(row.value)
}</dd>`;

const page = (host) => {
    const found = checks();
    const failed = found.filter((one) => !one.ok);
    const passed = found.length - failed.length;
    const here = at(host);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tube diagnostics</title>
</head>
<body>
<main>
<header>
<h1>Tube</h1>
<p>
<meter value="${passed}" max="${found.length}" optimum="${found.length}">${passed} of ${found.length}</meter>
${failed.length ? `<strong>${failed.length} of ${found.length} checks failed.</strong>` : `All ${found.length} checks passed.`}
Patch <code>${escaped(STAMP)}</code>.
</p>
</header>

<nav>
<h2>Help</h2>
<ul>
<li><a href="${escaped(DISCORD)}">Join the Discord</a> — ask there, with the log below</li>
<li><a href="${escaped(here)}/__tube/log">Open the log</a></li>
<li><a href="${escaped(REPO)}">Report on GitHub</a></li>
</ul>
</nav>

<details${failed.length ? ' open' : ''}>
<summary>Checks</summary>
<ul>
${found.map(item).join('\n')}
</ul>
</details>

<section>
<h2>This TV</h2>
<dl>
${thisTvRows(host).map(pair).join('\n')}
</dl>
</section>
</main>
</body>
</html>
`;
};

module.exports = { page, thisTvRows };
