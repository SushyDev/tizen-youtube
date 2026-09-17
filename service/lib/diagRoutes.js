'use strict';

// The page a viewer is sent to when the app will not start.

const { page } = require('./diagPage.js');

const attach = (app) => {
    app.get('/diag', (req, res) => {
        // No policy of ours: this one is read in a phone's browser, not in Cobalt.
        res.removeHeader('Content-Security-Policy');
        res.type('html').send(page(req.headers.host));
    });
};

module.exports = { attach };
