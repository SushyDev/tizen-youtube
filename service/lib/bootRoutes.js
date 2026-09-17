'use strict';

const postmortem = require('./postmortem.js');
const { report } = require('./bootReport.js');
const { fromScreen } = require('./pageLines.js');

const NO_COBALT = { needsCertificate: false, prepared: false, failed: null };

const noteWait = (waited) => {
    if (waited) postmortem.note('boot', `the boot screen reached the service after ${(waited / 1000).toFixed(1)}s`);
};

const attach = (app, { cobalt, script }) => {
    // Asked as YouTube's host, so an answer proves the whole path.
    app.get('/__tube/ping', (_, res) => res.status(204).end());

    // Asked from inside the container, so an answer also claims it.
    app.get('/__tube/boot', (req, res) => {
        if (cobalt) cobalt.served();

        noteWait(Number(req.query.waited) || 0);
        fromScreen(req.query.said);
        if (req.query.restart && cobalt) cobalt.restart();

        res.json(report({
            since: req.query.since,
            status: cobalt ? cobalt.status() : NO_COBALT,
            script: script(),
            stuck: !!req.query.stuck
        }));
    });
};

module.exports = { attach };
