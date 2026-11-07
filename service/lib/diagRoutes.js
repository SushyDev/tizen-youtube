'use strict';

const { page, thisTvRows } = require('./diagPage.js');
const postmortem = require('./postmortem.js');
const { bundle, asText } = require('./diagBundle.js');
const { redact } = require('./redact.js');
const { STAMP } = require('./stamp.js');

const attach = (app) => {
    app.get('/diag', (req, res) => {
        // No policy of ours: this one is read in a phone's browser, not in Cobalt.
        res.removeHeader('Content-Security-Policy');
        res.type('html').send(page(req.headers.host));
    });

    app.get('/__tube/facts', (req, res) => res.json(thisTvRows(req.headers.host)));

    app.get('/diag.json', (req, res) => res.json(bundle(thisTvRows(req.headers.host))));

    // The summary, then the whole service log, with what identifies the viewer taken out.
    app.get('/diag/logs.txt', (req, res) => {
        const log = postmortem.read().split('\n').map(redact).join('\n');
        const text = `${asText(bundle(thisTvRows(req.headers.host)))}\n\nservice log\n\n${log || '(nothing logged)'}\n`;

        res.removeHeader('Content-Security-Policy');
        if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="tube-logs-${STAMP}.txt"`);
        res.type('text/plain; charset=utf-8').send(text);
    });
};

module.exports = { attach };
