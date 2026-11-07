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
const { SUPPORT_URL } = require('./support.js');
const { bundle, asText } = require('./diagBundle.js');

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

// What a viewer reads first: the failure in plain words, then the raw detail below it.
const PLAIN = {
    cobalt: 'The TV\'s own YouTube engine (Cobalt) was not found, so Tube has nothing to run.',
    container: 'This build of Tube does not claim the YouTube engine, so it cannot start it.',
    'container slot': 'Another app, usually the stock YouTube app, is holding the YouTube engine.',
    share: 'Tube cannot write its files to the TV\'s storage.',
    youtube: 'Tube\'s service cannot reach YouTube from this TV.',
    content: 'Tube\'s copy of the YouTube engine\'s files is missing.',
    icu: 'A data folder the YouTube engine needs is missing.',
    'boot screen': 'The start screen Tube shows was never written.'
};

const plainly = (found) => PLAIN[found.name] || `${found.name} failed.`;

const STYLE = `body { margin: 0; font: 16px/1.5 -apple-system, system-ui, sans-serif; color: #1d232a; background: #f4f6f8; }
main { max-width: 640px; margin: 0 auto; padding: 16px; }
h1 { margin: 0 0 4px; font-size: 24px; }
h2 { font-size: 18px; margin: 24px 0 8px; }
.verdict { padding: 12px 14px; border-radius: 8px; background: #e3f4e8; }
.verdict.failing { background: #fde8e8; }
.verdict p { margin: 4px 0; }
button { font: inherit; font-weight: 600; padding: 12px 16px; border-radius: 8px; border: 0; width: 100%; margin: 6px 0; }
.primary { background: #3b5bdb; color: #ffffff; }
.secondary { background: #dfe3e8; color: #1d232a; }
#code { font: 700 32px/1.3 ui-monospace, monospace; letter-spacing: 3px; text-align: center; margin: 8px 0; }
#said { min-height: 1.5em; }
textarea { width: 100%; box-sizing: border-box; height: 160px; font: 12px/1.4 ui-monospace, monospace; }
ul { padding-left: 20px; }
li.bad { color: #b42318; }
code { word-break: break-all; font-size: 13px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; }
dt { font-weight: 600; }
dd { margin: 0; word-break: break-word; }`;

// Inline and ES5, so any phone browser runs it without fetching anything but this TV and the support bot.
const SCRIPT = `(function () {
var support = document.body.getAttribute('data-support');
var said = document.getElementById('said');
var tell = function (text) { said.textContent = text; };
var copy = function (text) {
    var area = document.getElementById('report');
    area.value = text; area.style.display = 'block'; area.focus(); area.select();
    try { if (document.execCommand('copy')) { tell('Copied. Paste it in the Discord.'); return; } } catch (e) {}
    tell('Select the text above and copy it.');
};
var send = document.getElementById('send');
if (send) send.onclick = function () {
    send.disabled = true; tell('Sending…');
    fetch('/diag.json').then(function (r) { return r.json(); }).then(function (body) {
        return fetch(support + '/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (answer) {
        document.getElementById('code').textContent = answer.code;
        tell('Paste this code in the Discord, in your help thread or #general.');
        var again = document.getElementById('copy-code'); again.style.display = 'block';
        again.onclick = function () { copy(answer.code); };
    }).catch(function (error) {
        send.disabled = false; tell('Could not send (' + error.message + '). Use Copy report instead.');
    });
};
document.getElementById('copy').onclick = function () { copy(document.getElementById('report').getAttribute('data-text')); };
}());`;

const verdict = (found, failed) => (failed.length
    ? `<div class="verdict failing">
<p><strong>${failed.length} of ${found.length} checks failed.</strong></p>
${failed.map((one) => `<p>${escaped(plainly(one))}</p>`).join('\n')}
</div>`
    : `<div class="verdict"><p>All ${found.length} checks passed. Tube's service is running on this TV.</p></div>`);

const sharing = (text) => `<section>
<h2>Get help</h2>
${SUPPORT_URL ? '<button class="primary" id="send" type="button">Send to support</button>' : ''}
<div id="code"></div>
<button class="secondary" id="copy-code" type="button" style="display:none">Copy code</button>
<button class="secondary" id="copy" type="button">Copy report</button>
<p id="said"></p>
<textarea id="report" readonly style="display:none" data-text="${escaped(text)}"></textarea>
</section>`;

const page = (host) => {
    const found = checks();
    const failed = found.filter((one) => !one.ok);
    const passed = found.length - failed.length;
    const here = at(host);
    const rows = thisTvRows(host);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tube diagnostics</title>
<style>
${STYLE}
</style>
</head>
<body data-support="${escaped(SUPPORT_URL)}">
<main>
<header>
<h1>Tube</h1>
<p>
<meter value="${passed}" max="${found.length}" optimum="${found.length}">${passed} of ${found.length}</meter>
Patch <code>${escaped(STAMP)}</code>.
</p>
${verdict(found, failed)}
</header>

${sharing(asText(bundle(rows)))}

<nav>
<h2>Help</h2>
<ul>
<li><a href="${escaped(DISCORD)}">Join the Discord</a> — ask there, with the code or the report above</li>
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
${rows.map(pair).join('\n')}
</dl>
</section>
</main>
<script>
${SCRIPT}
</script>
</body>
</html>
`;
};

module.exports = { page, thisTvRows };
