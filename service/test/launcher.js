'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tube-launcher-'));
process.env.TUBE_LOG = path.join(scratch, 'service.log');
process.env.TUBE_SHARE = path.join(scratch, 'share');

const express = require('express');
const postmortem = require('../lib/postmortem.js');
const configModule = require('../lib/cobaltConfig.js');
const player = 'tUb3Xq7L10.Tube';
configModule.appId = () => player;
const bootRoutes = require('../lib/bootRoutes.js');
const diagRoutes = require('../lib/diagRoutes.js');

const results = [];

const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  <- ${detail}`}`);
    results.push(!!ok);
};

const ask = (port, route) => new Promise((done) => {
    http.get({ host: '127.0.0.1', port, path: route, headers: { host: `127.0.0.2:${port}` } }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
});

const exits = [];
const realExit = process.exit;

const app = express();
const preparing = { prepared: false, failed: null };
const playerApp = express();
bootRoutes.attach(playerApp, { cobalt: { status: () => preparing }, script: () => ({ bytes: 1 }) });
app.use('/player', playerApp);
bootRoutes.attach(app, { cobalt: null, script: () => ({ bytes: 1 }) });
diagRoutes.attach(app);

const server = app.listen(0, '127.0.0.1', async () => {
    const { port } = server.address();

    postmortem.note('upstream', 'GET https://www.youtube.com/tv?token=secret123 → 200');

    const page = await ask(port, '/tube/boot.html');
    const config = JSON.parse(/window\.TUBE_BOOT = (\{[^<]*\});/.exec(page.body)[1]);
    check('the 5.0 widget gets the launcher from the service', page.status === 200 && /html/.test(page.headers['content-type'])
        && page.body.indexOf('id="buttons"') !== -1, page.status);
    check('pointing at the address it was asked on', config.service === `http://127.0.0.2:${port}`
        && config.target === `http://127.0.0.2:${port}/tv`, JSON.stringify(config).slice(0, 200));

    const boot = JSON.parse((await ask(port, '/__tube/boot?since=0')).body);
    check('without a container there is nothing to prepare', boot.cobalt && boot.cobalt.settled === true && boot.cobalt.failed === null,
        JSON.stringify(boot.cobalt));

    const launchStatus = await ask(port, '/player/__tube/launcher');
    check('the Tizen 10 launcher can identify the service and wait while Cobalt is staged',
        launchStatus.headers['cache-control'] === 'no-store'
        && JSON.parse(launchStatus.body).player === player
        && JSON.parse(launchStatus.body).ready === false);

    preparing.failed = 'Could not write boot.html';
    const failedPreparation = JSON.parse((await ask(port, '/player/__tube/launcher')).body);
    check('the Tizen 10 launcher sees preparation failures before opening Cobalt',
        !failedPreparation.ready && failedPreparation.error === preparing.failed);

    preparing.failed = null;
    preparing.prepared = true;
    const prepared = JSON.parse((await ask(port, '/player/__tube/launcher')).body);
    check('the Tizen 10 launcher can start the player once the boot page is ready',
        prepared.ready && prepared.player === player && prepared.error === null);

    const opened = await ask(port, '/diag/logs.txt');
    check('the logs open as text in the phone\'s browser', opened.status === 200 && /^text\/plain/.test(opened.headers['content-type'])
        && !opened.headers['content-disposition'], JSON.stringify(opened.headers));
    check('with the summary and the whole service log', opened.body.indexOf('Tube ') === 0 && opened.body.indexOf('service log') !== -1
        && opened.body.indexOf('upstream: GET https://www.youtube.com/tv?…') !== -1, opened.body.slice(0, 300));
    check('but nothing that identifies the viewer', opened.body.indexOf('secret123') === -1);

    const downloaded = await ask(port, '/diag/logs.txt?download=1');
    check('and download as a .txt file', /^attachment; filename="tube-logs-[^"]+\.txt"$/.test(downloaded.headers['content-disposition'] || ''),
        downloaded.headers['content-disposition']);

    process.exit = (code) => exits.push(code);
    const restart = await ask(port, '/__tube/restart-service');
    await new Promise((done) => setTimeout(done, 500));
    process.exit = realExit;

    check('restart answers before the service goes', restart.status === 202);
    check('then exits with a failure, so the platform starts it again', exits.length === 1 && exits[0] === 1, exits.join(','));
    check('and says why in its log', postmortem.read().indexOf('restart: asked for by the launcher') !== -1);

    server.close();
    fs.rmSync(scratch, { recursive: true, force: true });

    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
});
