'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tube-trail-'));
process.env.TUBE_SHARE = path.join(scratch, 'share');
process.env.TUBE_COBALT_CONTENT = path.join(scratch, 'content');

const trail = require('../lib/trail.js');

const results = [];

const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  <- ${detail}`}`);
    results.push(!!ok);
};

const earlier = Array.from({ length: 8 }).map((_, index) => ({ at: index, reached: [], ended: null }));
fs.mkdirSync(process.env.TUBE_SHARE, { recursive: true });
fs.writeFileSync(trail.FILE, JSON.stringify(earlier));

trail.begin();
const begun = trail.runs();
const mine = begun[begun.length - 1];

check('a run is written the moment it begins', mine && mine.pid === process.pid && mine.reached[0].stage === 'loaded',
    JSON.stringify(mine));
check('and keeps only the last few runs', begun.length === 6 && begun[0].at === 3, begun.map((run) => run.at).join(','));
check('with the TV\'s uptime and the node it runs on', typeof mine.uptime === 'number' && mine.node === process.version);

trail.reach('modules');
trail.reach('modules');
trail.reach('listening');
trail.count('starts');
trail.count('requests');
trail.count('requests');

const reached = trail.runs().pop();
check('each stage is noted once, in order', reached.reached.map((one) => one.stage).join(',') === 'loaded,modules,listening',
    JSON.stringify(reached.reached));
check('and wake calls are counted', reached.starts === 1 && reached.requests === 2);

const page = fs.readFileSync(path.join(process.env.TUBE_COBALT_CONTENT, trail.RELATIVE), 'utf8');
const loaded = {};
new Function('window', page)(loaded);
check('the boot page gets the same runs as a script beside it', JSON.stringify(loaded.TUBE_TRAIL) === JSON.stringify(trail.runs()));

trail.end('exit code 3');
trail.end('exit code 0');
const ended = trail.runs().pop();
check('the first ending is the one kept', ended.ended && ended.ended.how === 'exit code 3', JSON.stringify(ended.ended));

fs.writeFileSync(trail.FILE, 'not json');
check('a damaged trail reads as empty rather than throwing', trail.runs().length === 0);

fs.rmSync(scratch, { recursive: true, force: true });

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
