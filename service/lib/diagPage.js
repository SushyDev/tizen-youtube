'use strict';

// The page at /diag, read on a phone rather than on the television.
//
// Server-rendered, with no stylesheet, no script and nothing fetched: it is opened from a LAN that
// may have no route to the internet, and a page that needs a CDN to render fails exactly when it
// is wanted. The elements carry it — <details> opens itself when something failed, <meter> draws
// the tally, <strong> marks a failure in the browser's own bold.

const os = require('os');

const ports = require('./ports.js');
const { STAMP } = require('./stamp.js');
const { DISCORD, REPO } = require('./links.js');
const { facts } = require('./platform.js');
const { checks } = require('./diagnosis.js');

const escaped = (value) => String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Said plainly, because "null" on a diagnostics page reads as a fault rather than a blank.
const shown = (value) => (value === null || value === undefined || value === '' ? 'not readable here' : value);

const seconds = () => Math.round(process.uptime());

const worded = (count) => {
    if (count < 120) return `${count}s`;

    return count < 7200 ? `${Math.round(count / 60)}m` : `${Math.round(count / 3600)}h`;
};

const pair = (key, value) => `<dt>${escaped(key)}</dt><dd>${escaped(shown(value))}</dd>`;

const item = (found) => `<li class="${found.ok ? 'ok' : 'bad'}">`
    + (found.ok ? '' : '<strong>FAILED</strong> ')
    + `<b>${escaped(found.name)}</b> — <code>${escaped(found.detail)}</code></li>`;

// The address the phone already reached us on, so the log link works from the same network.
const at = (host) => `http://${(host || 'localhost').replace(/:\d+$/, '')}:${ports.PROXY}`;

// Where else this set answers. The loopbacks are not worth printing — they are the same on every
// television — but which LAN address it took is the thing a viewer is asked for and cannot find.
const onTheNetwork = () => {
    const interfaces = os.networkInterfaces();

    return Object.keys(interfaces).reduce((all, device) => all.concat(interfaces[device]
        .filter((entry) => !entry.internal && entry.family === 'IPv4')
        .map((entry) => entry.address)), []).join(', ');
};

const page = (host) => {
    const found = checks();
    const failed = found.filter((one) => !one.ok);
    const passed = found.length - failed.length;
    const here = at(host);
    const known = facts(null);

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
${pair('Tizen', known.tizen)}
${pair('Model', known.model)}
${pair('Node', known.node)}
<dt>Service</dt><dd>pid ${escaped(known.pid)}, up <time datetime="PT${seconds()}S">${worded(seconds())}</time></dd>
${pair('Host', os.hostname())}
${pair('Address', here)}
${pair('On the network', onTheNetwork())}
</dl>
</section>
</main>
</body>
</html>
`;
};

module.exports = { page };
