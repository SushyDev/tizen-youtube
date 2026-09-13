'use strict';

// A route that throws is noted rather than printed to a console nobody reads.

const postmortem = require('./postmortem.js');

const attach = (app) => app.use((error, req, res, next) => {
    postmortem.note('route', `${req.method} ${String(req.url).slice(0, 90)}: ${postmortem.describe(error)}`);

    if (res.headersSent) return res.destroy();
    return res.status(500).type('text/plain').send(`tube: ${error && error.message}`);
});

module.exports = { attach };
