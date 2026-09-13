'use strict';

// /__tube/log as one continuous journal: the page's lines land in it, a rotation does not cut it,
// and what the service prints or how its last run ended are in it too.

const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG = path.join(os.tmpdir(), `tube-journal-${process.pid}.log`);
process.env.TUBE_LOG = LOG;

const postmortem = require('../lib/postmortem.js');
const { fromPage, PAGE } = require('../lib/pageLines.js');

const results = [];

const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  <- ${detail}`}`);
    results.push(!!ok);
};

const pageLinesIn = () => postmortem.since(0).lines.filter((line) => line.what === PAGE).map((line) => line.text);

fromPage('sponsorblock: failed - TypeError: segments is undefined');
check('a page line is noted under page', pageLinesIn()[0] === 'sponsorblock: failed - TypeError: segments is undefined');
check('and written to the journal file', /page: sponsorblock: failed/.test(postmortem.read()));

fromPage('sponsorblock: failed - TypeError: segments is undefined');
check('a line already among the recent ones is not noted again', pageLinesIn().length === 1);

fromPage('');
fromPage(undefined);
check('an empty line is not noted', pageLinesIn().length === 1);

fromPage('x'.repeat(2000));
check('a long line is cut short', pageLinesIn()[1].length === 500);

// Past the rotation size, the older lines move to .1 and must still be read first.
postmortem.note('started', 'the first boot');
fs.appendFileSync(LOG, 'filler\n'.repeat(12 * 1024));
postmortem.note('listening', '0.0.0.0:8099');

const journal = postmortem.read();
check('a rotation moves the older lines aside', fs.existsSync(`${LOG}.1`) && !/the first boot/.test(fs.readFileSync(LOG, 'utf8')));
check('and the journal still reads from the start, in order', journal.indexOf('the first boot') !== -1
    && journal.indexOf('the first boot') < journal.indexOf('listening: 0.0.0.0:8099'));

check('a screen asking past the end, as after a restart, is sent everything',
    postmortem.since(100000).lines.length === postmortem.since(0).lines.length);

// A run that crashed, then a fresh service started beside that log.
fs.appendFileSync(LOG, `${new Date().toISOString()}  started: pid 1, node v16.5.0\n`
    + `${new Date().toISOString()}  uncaught: TypeError: tizen.foo is not a function\n    at somewhere\n`
    + `${new Date().toISOString()}  exit: code 1\n`);

['../lib/postmortem.js', '../lib/lastRun.js', '../lib/printed.js'].forEach((name) => delete require.cache[require.resolve(name)]);

const restarted = require('../lib/postmortem.js');
const lastRun = require('../lib/lastRun.js');
const printed = require('../lib/printed.js');

const quiet = { error: console.error, warn: console.warn };
console.error = () => undefined;
console.warn = () => undefined;

lastRun.recall();
restarted.watch();
printed.attach();

const whatIn = (what) => restarted.since(0).lines.filter((line) => line.what === what).map((line) => line.text);

check('how the last run ended is shown first', whatIn('previous').join(' | ')
    === 'uncaught: TypeError: tizen.foo is not a function | exit: code 1', whatIn('previous').join(' | '));
check('before this run\'s own start', restarted.since(0).lines[0].what === 'previous');

console.error('could not read %s', 'the cache');
console.warn('slow start');
check('what the service prints is noted', whatIn('error')[0] === 'could not read the cache' && whatIn('warning')[0] === 'slow start');

process.emitWarning('this node lacks something', 'ExperimentalWarning');

setTimeout(() => {
    check('and node\'s own warnings', whatIn('warning').indexOf('ExperimentalWarning: this node lacks something') !== -1,
        whatIn('warning').join(' | '));

    console.error = quiet.error;
    console.warn = quiet.warn;

    [LOG, `${LOG}.1`].forEach((file) => { try { fs.unlinkSync(file); } catch (e) { /* not there */ } });

    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
}, 0);
