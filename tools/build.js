'use strict';

const { execFileSync } = require('child_process');
const { existsSync, statSync, readFileSync } = require('fs');
const { join } = require('path');

const ui = require('./report.js');
const { load, ROOT } = require('./config.js');
const paths = require('./paths.js');
const { assertNoTokens } = require('./inject.js');

const STEPS = [
    {
        label: 'userscript bundle',
        command: ['npx', ['rollup', '-c', 'tools/rollup.config.mjs']],
        after: ['node', ['tools/check-output.js', paths.BUNDLE, 'cobalt3']],
        outputs: [paths.BUNDLE],
        summarise: (sizes) => ui.bytes(sizes[0])
    },
    {
        label: 'service bundle',
        command: ['node', ['tools/build-service.js']],
        outputs: [paths.SERVICE_BUNDLE],
        summarise: (sizes) => `${ui.bytes(sizes[0])} · floor verified`
    }
];

function cleanOutput(raw) {
    const lines = String(raw).split('\n');
    const kept = [];

    for (const line of lines) {
        if (/^npm (error|notice|warn)\b/.test(line.trim())) continue;
        if (/^\s+at .*[\\/]node_modules[\\/]/.test(line)) continue;
        kept.push(line);
    }

    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function runStep(step) {
    const started = Date.now();
    const commands = [step.command].concat(step.after ? [step.after] : []);

    try {
        commands.forEach(([command, args]) => execFileSync(command, args, {
            cwd: ROOT,
            stdio: 'pipe',
            encoding: 'utf8'
        }));
    } catch (e) {
        const error = new Error(
            `${step.label} failed to build.\n\n${cleanOutput(`${e.stdout || ''}${e.stderr || ''}`) || e.message}`
        );
        error.isFriendly = true;
        throw error;
    }

    const missing = step.outputs.filter((path) => !existsSync(join(ROOT, path)));
    if (missing.length) {
        const error = new Error(`${step.label} reported success but did not produce:\n  ${missing.join('\n  ')}`);
        error.isFriendly = true;
        throw error;
    }

    step.outputs
        .filter((path) => path.endsWith('.js'))
        .forEach((path) => assertNoTokens(readFileSync(join(ROOT, path), 'utf8'), path));

    const sizes = step.outputs.map((path) => statSync(join(ROOT, path)).size);
    return { ms: Date.now() - started, detail: step.summarise(sizes) };
}

function main() {
    const config = load();

    ui.heading('build', `v${config.version}`);
    ui.info('origin', config.origin);

    if (config.placeholders.length) {
        ui.warn('origin still points at an example host — fine for development, blocked by `npm run release`');
    }

    const started = Date.now();

    ui.group('YouTube');
    STEPS.forEach((step) => {
        const result = runStep(step);
        ui.ok(step.label, result.detail, result.ms);
    });

    ui.blank();
    ui.note(`Built in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
    ui.note(ui.style.dim('Next:  npm test   ·   npm run package   ·   npm run release'));
    ui.blank();
}

try {
    main();
} catch (err) {
    ui.crash(err);
}
