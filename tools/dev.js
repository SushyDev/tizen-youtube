'use strict';

const { spawn } = require('child_process');
const { createServer } = require('net');
const { join } = require('path');

const ui = require('./report.js');
const { load, ROOT } = require('./config.js');

// Read from tizen.config.json rather than from service/lib/ports.js: a build tool reaching into
// shipped runtime code is the wrong direction, and the number has a home now.
const ports = load().ports;

// YouTube serves the TV site only to a TV user agent.
const TV_USER_AGENT = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) 94.0.4606.31/6.5 TV Safari/537.36';

const COLOURS = { mods: ui.style.magenta, svc: ui.style.yellow };

const running = { children: [] };

const portIsFree = (port) => new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
});

const relay = (label, stream) => {
    const held = { partial: '' };

    stream.on('data', (chunk) => {
        const lines = (held.partial + chunk.toString()).split('\n');
        held.partial = lines[lines.length - 1];

        lines.slice(0, -1).filter((line) => line.trim()).forEach((line) => {
            process.stdout.write(`  ${COLOURS[label](label)}  ${line.trim()}\n`);
        });
    });
};

const start = (label, command, args, options) => {
    const child = spawn(command, args, {
        cwd: options.cwd,
        env: Object.assign({}, process.env, options.env || {}),
        stdio: ['ignore', 'pipe', 'pipe']
    });

    relay(label, child.stdout);
    relay(label, child.stderr);

    child.on('error', (error) => ui.fail(label, error.message));
    child.on('exit', (code) => {
        if (code) ui.fail(label, `exited with code ${code}`);
    });

    running.children = running.children.concat(child);
    return child;
};

const stopEverything = () => {
    const children = running.children;
    running.children = [];
    children.forEach((child) => child.kill());
};

const watchTheUserscript = () => start('mods', 'npx', ['rollup', '-c', 'rollup.config.js', '-w'], {
    cwd: join(ROOT, 'mods')
});

// TUBE_DEV_INJECT puts the remote in the page: the TV's coloured buttons have no key on a
// keyboard, and the mods listen for their key codes and nothing else.
const runTheService = () => start('svc', process.execPath, ['index.js'], {
    cwd: join(ROOT, 'service'),
    env: {
        TUBE_DEV_UA: process.env.TUBE_DEV_UA || TV_USER_AGENT,
        TUBE_BUNDLE_DIR: join(ROOT, 'dist'),
        TUBE_CACHE_DIR: join(ROOT, '.dev', 'cache'),
        TUBE_DEV_INJECT: join(__dirname, 'dev', 'remote.js')
    }
});

const main = async () => {
    ui.heading('dev');

    watchTheUserscript();

    if (await portIsFree(ports.proxy)) {
        runTheService();
    } else {
        ui.warn(`something is already on :${ports.proxy} — using it rather than starting a second service`);
    }

    ui.blank();
    ui.info('youtube', `http://localhost:${ports.proxy}/tv`);
    ui.info('log', `http://localhost:${ports.proxy}/__tube/log`);
    ui.info('keys', 'b is the blue button, escape is return, tubeRemote(code) presses anything');
    ui.blank();

    process.on('SIGINT', () => { stopEverything(); process.exit(0); });
    process.on('SIGTERM', () => { stopEverything(); process.exit(0); });
    process.on('exit', stopEverything);
};

main().catch((err) => ui.crash(err));
