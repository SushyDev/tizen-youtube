'use strict';

const { execFileSync } = require('child_process');

const ui = require('./report.js');
const { ROOT } = require('./config.js');

const SUITES = [
    { name: 'userscript', command: ['node', ['test/index.js']] },
    { name: 'service', workspace: 'service' }
];

ui.heading('test');

const gate = (name, command, args, detail) => {
    const started = Date.now();
    try {
        execFileSync(command, args, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
        ui.ok(name, detail, Date.now() - started);
        return 0;
    } catch (e) {
        ui.fail(name, 'errors found');
        `${e.stdout || ''}${e.stderr || ''}`.split('\n')
            .filter((line) => line.trim())
            .slice(0, 25)
            .forEach((line) => process.stdout.write(`      ${line}\n`));
        return 1;
    }
};

let failures = gate('lint', 'npx', ['eslint', '.'], 'no errors')
    + gate('types', 'npx', ['tsc', '--noEmit'], 'no errors');

SUITES.forEach((suite) => {
    const started = Date.now();
    let output = '';
    let failed = false;

    const invocation = suite.workspace
        ? ['npm', ['test', '--workspace', suite.workspace]]
        : suite.command;

    try {
        output = execFileSync(invocation[0], invocation[1], {
            cwd: ROOT,
            stdio: 'pipe',
            encoding: 'utf8'
        });
    } catch (e) {
        failed = true;
        failures++;
        output = `${e.stdout || ''}${e.stderr || ''}`;
    }

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
