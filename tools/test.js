'use strict';

const { execFileSync } = require('child_process');

const ui = require('./report.js');
const { ROOT } = require('./config.js');

// Two kinds of thing run here. A gate is a command judged only by its exit status; a suite prints
// `n/m checks passed` per file and is judged by the sum of those lines as well.
const GATES = [
    { name: 'lint', command: 'npx', args: ['eslint', '.'] },
    { name: 'types', command: 'npx', args: ['tsc', '--noEmit'] }
];

const SUITES = [
    { name: 'userscript', command: ['node', ['test/index.js']] },
    { name: 'service', workspace: 'service' }
];

const RUN = { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' };

const spoken = (e) => `${e.stdout || ''}${e.stderr || ''}`;

const echo = (lines) => lines.forEach((line) => process.stdout.write(`      ${line}\n`));

const runGate = (gate) => {
    const started = Date.now();
    try {
        execFileSync(gate.command, gate.args, RUN);
        ui.ok(gate.name, 'no errors', Date.now() - started);
        return true;
    } catch (e) {
        ui.fail(gate.name, 'errors found');
        echo(spoken(e).split('\n').filter((line) => line.trim()).slice(0, 25));
        return false;
    }
};

const invocationOf = (suite) => (suite.workspace
    ? ['npm', ['test', '--workspace', suite.workspace]]
    : suite.command);

// A failed suite is still read for its counts: knowing 88 of 90 passed says more than "it failed".
const attempt = (suite) => {
    const invocation = invocationOf(suite);
    try {
        return { failed: false, output: execFileSync(invocation[0], invocation[1], RUN) };
    } catch (e) {
        return { failed: true, output: spoken(e) };
    }
};

const tally = (output) => (output.match(/\d+\/\d+ checks passed/g) || [])
    .map((line) => line.match(/(\d+)\/(\d+)/))
    .reduce((sum, parts) => ({
        passed: sum.passed + Number(parts[1]),
        total: sum.total + Number(parts[2])
    }), { passed: 0, total: 0 });

const runSuite = (suite) => {
    const started = Date.now();
    const run = attempt(suite);
    const counted = tally(run.output);
    const detail = counted.total ? `${counted.passed}/${counted.total} checks` : 'no checks reported';

    if (!run.failed) {
        ui.ok(suite.name, detail, Date.now() - started);
        return true;
    }

    ui.fail(suite.name, detail);
    echo(run.output.split('\n')
        .filter((line) => /^(FAIL|PASS)|Error|error:/.test(line.trim()) && !/^npm error/.test(line.trim()))
        .slice(0, 30));
    return false;
};

ui.heading('test');

const failures = GATES.map(runGate).concat(SUITES.map(runSuite)).filter((ok) => !ok).length;

ui.blank();
if (failures) {
    ui.note(`${failures} suite${failures === 1 ? '' : 's'} failed.`);
    process.exit(1);
}
ui.note('All suites passed.');
ui.blank();
