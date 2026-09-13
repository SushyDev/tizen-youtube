'use strict';

// The journal: reading it, and the page's side of it.

const postmortem = require('./postmortem.js');
const { fromPage } = require('./pageLines.js');

const attach = (app) => {
    // No console in the container, so this is the only way to read it.
    app.get('/__tube/log', (_, res) => res.type('text/plain').send(postmortem.read() || '(nothing logged)'));

    app.get('/__tube/journal', (req, res) => {
        fromPage(req.query.m);
        res.status(204).end();
    });
};

module.exports = { attach };
