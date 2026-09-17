'use strict';

const { execFileSync } = require('child_process');
const { existsSync, statSync, readFileSync } = require('fs');
const { join } = require('path');

const ui = require('./report.js');
const { load, ROOT } = require('./config.js');
const paths = require('./paths.js');
const { assertNoTokens } = require('./inject.js');

// Both services embed the userscript, so it builds first.
const STEPS = [
    {
        label: 'userscript bundle',
        target: 'modern',
        command: ['npx', ['rollup', '-c', 'tools/rollup.config.mjs']],
        // Both widgets carry this same bundle, so it is held to the older engine of the two.
        after: [
            ['node', ['tools/check-output.js', paths.BUNDLE, 'cobalt20']],
            ['node', ['tools/check-output.js', paths.BOOT_BUNDLE, 'cobalt20']]
        ],
        outputs: [paths.BUNDLE, paths.BOOT_BUNDLE],
        summarise: (sizes) => ui.bytes(sizes[0])
    },
    {
        label: 'service bundle',
        target: 'modern',
        command: ['node', ['tools/build-service.js']],
        outputs: [paths.SERVICE_BUNDLE],
        summarise: (sizes) => `${ui.bytes(sizes[0])} · floor verified`
    },
    {
        label: 'legacy service bundle',
        target: 'legacy',
        command: ['node', ['tools/build-service.js']],
        outputs: [paths.SERVICE_BUNDLE_LEGACY],
        summarise: (sizes) => `${ui.bytes(sizes[0])} · floor verified`
    }
];

// Predicates rather than patterns: the first is judged on a trimmed line, the second on the
// leading whitespace of a stack frame.
const NOISE = [
    (line) => /^npm (error|notice|warn)\b/.test(line.trim()),
    (line) => /^\s+at .*[\\/]node_modules[\\/]/.test(line)
];

function cleanOutput(raw) {
    return String(raw).split('\n')
        .filter((line) => !NOISE.some((noise) => noise(line)))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function runStep(step) {
    const started = Date.now();
    const commands = [step.command].concat(step.after || []);

    try {
        commands.forEach(([command, args]) => execFileSync(command, args, {
            cwd: ROOT,
            env: Object.assign({}, process.env, { TUBE_TARGET: step.target }),
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

    const started = Date.now();

    ui.group('YouTube');
    STEPS.forEach((step) => {
        const result = runStep(step);
        ui.ok(step.label, result.detail, result.ms);
    });

    ui.blank();
    ui.note(`Built in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
    ui.note(ui.style.dim('Next:  npm test   ·   npm run package'));
    ui.blank();
}

try {
    main();
} catch (err) {
    ui.crash(err);
}
