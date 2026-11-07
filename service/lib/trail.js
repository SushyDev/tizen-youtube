'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { configuredContent } = require('./cobaltConfig.js');
const { STAMP } = require('./stamp.js');

const SHARE = process.env.TUBE_SHARE || '/home/owner/share/tube';
const FILE = path.join(SHARE, 'trail.json');

// Beside boot.html, so the boot page can load it with a script tag when nothing answers.
const RELATIVE = path.join('web', 'tube', 'trail.js');

const MOST = 6;

const threadId = () => {
    try { return require('worker_threads').threadId; } catch (e) { return null; }
};

const tizenCall = (call) => {
    try { return typeof tizen === 'undefined' ? null : call(); } catch (e) { return `unreadable: ${e.message}`; }
};

// What woke us: on a TV the platform passes an app control, and its caller tells boot, install and launch apart.
const control = () => tizenCall(() => {
    const asked = tizen.application.getCurrentApplication().getRequestedAppControl();
    if (!asked) return null;

    return { operation: asked.appControl.operation, caller: asked.callerAppId || '' };
});

const readRuns = () => {
    try {
        const kept = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        return Array.isArray(kept) ? kept : [];
    } catch (e) {
        return [];
    }
};

const state = { run: null, runs: [] };

const writeSafely = (file, text) => {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const staged = `${file}.${process.pid}.${threadId() || 0}`;
        fs.writeFileSync(staged, text);
        fs.renameSync(staged, file);
    } catch (e) { /* a trail must never be a reason to fail */ }
};

const save = () => {
    const all = state.runs.concat([state.run]);
    writeSafely(FILE, JSON.stringify(all));

    const content = configuredContent();
    if (content) writeSafely(path.join(content, RELATIVE), `window.TUBE_TRAIL = ${JSON.stringify(all)};\n`);
};

const since = () => Date.now() - state.run.at;

const reach = (stage) => {
    if (!state.run || state.run.reached.some((one) => one.stage === stage)) return;

    state.run.reached.push({ stage, after: since() });
    save();
};

const count = (what) => {
    if (!state.run) return;

    state.run[what] += 1;
    save();
};

const end = (how) => {
    if (!state.run || state.run.ended) return;

    state.run.ended = { how, after: since() };
    save();
};

// Required before anything else, so a service that dies while loading still leaves its first step.
const begin = () => {
    if (state.run) return;

    state.runs = readRuns().slice(-(MOST - 1));
    state.run = {
        at: Date.now(),
        uptime: Math.round(os.uptime()),
        pid: process.pid,
        thread: threadId(),
        node: process.version,
        patch: STAMP,
        control: control(),
        reached: [{ stage: 'loaded', after: 0 }],
        starts: 0,
        requests: 0,
        ended: null
    };
    save();

    // A monitor watches without changing how Node handles the crash.
    process.on('uncaughtExceptionMonitor', (error) => end(`crashed: ${String((error && error.message) || error).split('\n')[0]}`));
    process.on('exit', (code) => end(`exit code ${code}`));
};

const runs = () => readRuns();

module.exports = { begin, reach, count, end, runs, FILE, RELATIVE };
