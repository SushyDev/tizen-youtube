'use strict';

const postmortem = require('./postmortem.js');
const { fromPage } = require('./pageLines.js');

const attach = (app, hooks) => {
    const heard = (hooks && hooks.heard) || (() => undefined);

    // No console in the container, so this is the only way to read it.
    app.get('/__tube/log', (_, res) => res.type('text/plain').send(postmortem.read() || '(nothing logged)'));

    app.get('/__tube/journal', (req, res) => {
        const line = String(req.query.m || '');

        heard(line);
        fromPage(line);
        res.status(204).end();
    });
};

module.exports = { attach };
