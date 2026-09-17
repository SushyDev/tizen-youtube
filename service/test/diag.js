'use strict';

// The page at /diag, read on a phone rather than on the television.

const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tube-diag-'));
const content = path.join(root, 'content');

process.env.TUBE_LOG = path.join(root, 'service.log');
process.env.TUBE_SHARE = root;
process.env.TUBE_MITM_DIR = path.join(root, 'mitm');
process.env.TUBE_COBALT_CONTENT = content;

const postmortem = require('../lib/postmortem.js');
const { page } = require('../lib/diagPage.js');
const { DISCORD, REPO } = require('../lib/links.js');

const results = [];

const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  <- ${detail}`}`);
    results.push(!!ok);
};

fs.mkdirSync(path.join(content, 'icu'), { recursive: true });
fs.writeFileSync(path.join(content, 'icu', 'icudt68l.dat'), 'data');

const html = page('192.168.1.29:8099');

check('it is a whole page', html.indexOf('<!DOCTYPE html>') === 0 && html.indexOf('</html>') !== -1);
check('it fits a phone', html.indexOf('width=device-width') !== -1);

check('the elements carry the meaning', ['<main>', '<header>', '<nav>', '<section>', '<details', '<summary>', '<dl>']
    .every((tag) => html.indexOf(tag) !== -1));
check('the tally is drawn rather than described', /<meter value="\d+" max="\d+"/.test(html));
check('the uptime is machine-readable', /<time datetime="PT\d+S">/.test(html));

check('it offers the Discord', html.indexOf(DISCORD) !== -1);
check('and the repository', html.indexOf(REPO) !== -1);

check('it links the log at the address the phone reached the TV on',
    html.indexOf('http://192.168.1.29:8099/__tube/log') !== -1);

check('a host arriving without a port is still linked once', html.indexOf('http://192.168.1.29:8099:8099') === -1
    && page('192.168.1.29').indexOf('http://192.168.1.29:8099/__tube/log') !== -1);

check('it runs the same checks the boot screen asks for', html.indexOf('icu') !== -1
    && html.indexOf('certificate') !== -1);

check('a passing check is marked as passing', /class="ok"><b>icu<\/b>/.test(html), html.slice(html.indexOf('<ul>'), html.indexOf('</ul>')));
check('a failing one stands out without a stylesheet',
    /class="bad"><strong>FAILED<\/strong> <b>certificate<\/b>/.test(html));

// The element does the work a script would otherwise do: shut when there is nothing to read.
check('the checks open themselves when something failed', html.indexOf('<details open>') !== -1);
check('and the failure is called out at the top', /<strong>\d+ of \d+ checks failed\./.test(html));

// The loopbacks are the same on every set; the address it took from the router is the one a
// viewer is asked for and cannot find.
check('it names the addresses this TV answers on', html.indexOf('<dt>On the network</dt>') !== -1);

check('it carries no stylesheet at all', html.indexOf('<style') === -1 && html.indexOf('style=') === -1);
check('and the count is said at the top', /checks (failed|passed)/.test(html));

check('it says what could not be read rather than printing null',
    html.indexOf('>null<') === -1 && html.indexOf('not readable here') !== -1);

check('it needs nothing from the internet to render',
    html.indexOf('<script') === -1 && html.indexOf('src=') === -1 && html.indexOf('@import') === -1);

// A page that may be reloaded must not push the history out of a 64KB journal.
page('h');
page('h');
check('reading it leaves no trace in the journal', postmortem.read().indexOf('check:') === -1,
    postmortem.read().slice(-200));

// A detail carrying markup must not be able to write tags into the page.
fs.writeFileSync(path.join(content, '<img src=x onerror=alert(1)>'), 'x');
check('a file name is escaped rather than rendered', page('h').indexOf('<img src=x') === -1);

fs.rmSync(root, { recursive: true, force: true });

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
