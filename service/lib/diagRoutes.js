'use strict';

const { page, thisTvRows } = require('./diagPage.js');

const attach = (app) => {
    app.get('/diag', (req, res) => {
        // No policy of ours: this one is read in a phone's browser, not in Cobalt.
        res.removeHeader('Content-Security-Policy');
        res.type('html').send(page(req.headers.host));
    });

    app.get('/__tube/facts', (req, res) => res.json(thisTvRows(req.headers.host)));
};

module.exports = { attach };
