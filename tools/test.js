'use strict';

// Runs every test suite in the repo and summarises them together.
// Output from a passing suite is condensed; a failing suite prints in full.

const { execFileSync } = require('child_process');

const ui = require('./ui.js');
const { ROOT } = require('./config.js');

const SUITES = [
    { name: 'service', workspace: 'service' }
];

ui.heading('test');

let failures = 0;

// Lint first. `node --check` only validates syntax, so an undeclared variable reaches
// runtime and fails on whichever machine hits that line first.
{
    const started = Date.now();
    try {
        execFileSync('npx', ['eslint', '.'], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
        ui.ok('lint', 'no errors', Date.now() - started);

    } catch (e) {
        failures++;
        ui.fail('lint', 'correctness errors found');
        `${e.stdout || ''}${e.stderr || ''}`.split('\n')
            .filter((line) => line.trim())
            .slice(0, 25)
            .forEach((line) => process.stdout.write(`      ${line}\n`));
    }
}

SUITES.forEach((suite) => {
    const started = Date.now();
    let output = '';
    let failed = false;

    try {
        output = execFileSync('npm', ['test', '--workspace', suite.workspace], {
            cwd: ROOT,
            stdio: 'pipe',
            encoding: 'utf8'
        });
    } catch (e) {
        failed = true;
        failures++;
        output = `${e.stdout || ''}${e.stderr || ''}`;
    }

    // Every suite reports "N/M checks passed."; total them up.
    let passed = 0;
    let total = 0;
    const counts = output.match(/(\d+)\/(\d+) checks passed/g) || [];
    counts.forEach((line) => {
        const parts = line.match(/(\d+)\/(\d+)/);
        passed += Number(parts[1]);
        total += Number(parts[2]);
    });

    const detail = total ? `${passed}/${total} checks` : 'no checks reported';

    if (failed) {
        ui.fail(suite.name, detail);
        output.split('\n')
            .filter((line) => /^(FAIL|PASS)|Error|error:/.test(line.trim()) && !/^npm error/.test(line.trim()))
            .slice(0, 30)
            .forEach((line) => process.stdout.write(`      ${line}\n`));
    } else {
        ui.ok(suite.name, detail, Date.now() - started);
    }
});

ui.blank();
if (failures) {
    ui.note(`${failures} suite${failures === 1 ? '' : 's'} failed.`);
    process.exit(1);
}
ui.note('All suites passed.');
ui.blank();
