'use strict';

// One command to build the app.
//
//   npm run build
//
// Three parts: the boot screen the television shows while it starts, the two
// userscript bundles injected into YouTube, and the service that serves and
// injects them. Sub-build output is captured and shown only when something
// fails, so a successful build is a short, readable summary rather than a wall
// of log.

const { execFileSync } = require('child_process');
const { existsSync, statSync } = require('fs');
const { join } = require('path');

const ui = require('./ui.js');
const { load, ROOT } = require('./config.js');

const STEPS = [
    {
        label: 'boot screen',
        workspace: 'ui',
        outputs: ['ui/dist/index.html'],
        summarise: (sizes) => `${ui.bytes(sizes[0])} · single file`
    },
    {
        label: 'userscript bundles',
        workspace: 'mods',
        // The service embeds these, so they must exist before it builds.
        outputs: ['dist/userScript.modern.js', 'dist/userScript.legacy.js'],
        summarise: (sizes) => `modern ${ui.bytes(sizes[0])} · legacy ${ui.bytes(sizes[1])}`
    },
    {
        label: 'service bundle',
        workspace: 'service',
        outputs: ['service/dist/index.js'],
        summarise: (sizes) => `${ui.bytes(sizes[0])} · syntax floor verified`
    }
];

// npm wraps every failure in its own lifecycle boilerplate, which says
// nothing the underlying tool has not already said. Strip it so the actual
// compiler error is what a person reads first.
function cleanOutput(raw) {
    const lines = String(raw).split('\n');
    const kept = [];

    for (const line of lines) {
        if (/^npm (error|notice|warn)\b/.test(line.trim())) continue;
        // Deep frames inside node_modules are noise for a source-level error.
        if (/^\s+at .*[\\/]node_modules[\\/]/.test(line)) continue;
        kept.push(line);
    }

    // Collapse the runs of blank lines that removal leaves behind.
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function runStep(step) {
    const started = Date.now();
    try {
        execFileSync('npm', ['run', 'build', '--workspace', step.workspace], {
            cwd: ROOT,
            stdio: 'pipe',
            encoding: 'utf8'
        });
    } catch (e) {
        const error = new Error(
            `${step.workspace} failed to build.\n\n${cleanOutput(`${e.stdout || ''}${e.stderr || ''}`) || e.message}`
        );
        error.isFriendly = true;
        throw error;
    }

    const missing = step.outputs.filter((path) => !existsSync(join(ROOT, path)));
    if (missing.length) {
        const error = new Error(`${step.workspace} reported success but did not produce:\n  ${missing.join('\n  ')}`);
        error.isFriendly = true;
        throw error;
    }

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
