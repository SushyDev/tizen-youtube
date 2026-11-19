'use strict';

const http = require('http');
const os = require('os');
const { readFileSync } = require('fs');
const { join } = require('path');

const config = readFileSync(join(__dirname, '..', '..', 'config.xml'), 'utf8');
const app = /<tizen:application\s+id="([^"]+)"/.exec(config)[1];
const service = /<tizen:service\s+id="([^"]+\.TubeService)"/.exec(config)[1];
const port = Number('__TUBE_PROXY_PORT__');
const POLL = 4000;
const RETRY = 20000;
const MAX_RETRY = 300000;
const state = { run: null };

const answers = (host) => new Promise((resolve) => {
    const request = http.get({ host, port, path: '/__tube/ping', agent: false }, (response) => {
        response.resume();
        resolve(response.statusCode === 204 && response.headers['x-tube-app'] === app);
    });
    request.on('error', () => resolve(false));
    request.setTimeout(1000, () => request.destroy());
}).catch(() => false);

const healthy = async () => {
    if (await answers('127.0.0.2')) return true;

    const addresses = Object.values(os.networkInterfaces()).flat()
        .filter((address) => !address.internal && (address.family === 'IPv4' || address.family === 4));
    return (await Promise.all(addresses.map((address) => answers(address.address)))).some(Boolean);
};

const launch = () => {
    const failed = (error) => console.warn('Tube recovery:', error.message);
    try {
        const control = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/pick');
        tizen.application.launchAppControl(control, service, () => {}, failed);
    } catch (error) {
        failed(error);
    }
};

const poll = async (run) => {
    const ready = await healthy();
    if (state.run !== run) return;

    if (ready) {
        run.misses = 0;
        run.delay = RETRY;
        run.next = 0;
    } else {
        run.misses += 1;
        const now = Date.now();
        if (run.misses >= 2 && now >= run.next) {
            run.next = now + run.delay;
            run.delay = Math.min(run.delay * 2, MAX_RETRY);
            launch();
        }
    }
    run.timer = setTimeout(() => poll(run), POLL);
};

const start = () => {
    if (state.run) return;

    const run = { misses: 0, delay: RETRY, next: 0, timer: null };
    state.run = run;
    run.timer = setTimeout(() => poll(run), POLL);
};

module.exports = {
    onStart: start,
    onRequest: start,
    onStop: () => {
        if (state.run) clearTimeout(state.run.timer);
        state.run = null;
    }
};
