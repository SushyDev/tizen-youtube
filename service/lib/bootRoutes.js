'use strict';

const postmortem = require('./postmortem.js');
const trail = require('./trail.js');
const { report } = require('./bootReport.js');
const { fromScreen } = require('./pageLines.js');
const { html } = require('./bootScreen.js');
const { BOOT_PAGE, read } = require('./shipped.js');
const { fromThisTv, onlyThisTv } = require('./clients.js');

// Nothing to prepare, as on the 5.0 widget, counts as prepared.
const NO_COBALT = { prepared: false, settled: true, failed: null };

const RESTART_AFTER = 300;

const noteWait = (waited) => {
    if (waited) postmortem.note('boot', `the boot screen reached the service after ${(waited / 1000).toFixed(1)}s`);
};

const attach = (app, { cobalt, script }) => {
    // Asked as YouTube's host, so an answer proves the whole path.
    app.get('/__tube/ping', (_, res) => res.status(204).end());

    // Asked from inside the container, so an answer also claims it.
    app.get('/__tube/boot', (req, res) => {
        // Anyone may read the answer, but only the TV's own boot page acts through it.
        if (fromThisTv(req)) {
            if (cobalt) cobalt.served();
            trail.reach('boot page');

            noteWait(Number(req.query.waited) || 0);
            fromScreen(req.query.said);
            if (req.query.restart && cobalt) cobalt.restart();
        }

        res.json(report({
            since: req.query.since,
            status: cobalt ? cobalt.status() : NO_COBALT,
            script: script(),
            stuck: !!req.query.stuck
        }));
    });

    // The platform's auto-restart brings the service back, which is the only restart a service has.
    app.get('/__tube/restart-service', onlyThisTv((_, res) => {
        postmortem.note('restart', 'asked for by the launcher');
        trail.end('restarted from the launcher');
        res.status(202).json({ restarting: true });
        setTimeout(() => process.exit(1), RESTART_AFTER);
    }));

    // The 5.0 widget has no content directory, so its launcher comes from here instead of a file.
    app.get('/tube/boot.html', (req, res) => {
        res.type('html').send(html(read(BOOT_PAGE), { origin: `http://${req.headers.host}` }));
    });
};

module.exports = { attach };
