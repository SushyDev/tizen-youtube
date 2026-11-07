'use strict';

const postmortem = require('./postmortem.js');
const { STAMP } = require('./stamp.js');
const { checks } = require('./diagnosis.js');
const { redact } = require('./redact.js');
const trail = require('./trail.js');

const MOST_LINES = 400;

// What the diag page hands the support bot: the same rows and checks the page shows, and the log.
const bundle = (rows) => ({
    app: 'youtube',
    version: STAMP,
    report: {
        source: 'diag page',
        facts: rows.reduce((all, row) => Object.assign(all, { [row.key]: redact(row.value) }), {}),
        checks: checks().map((one) => ({ name: one.name, ok: one.ok, detail: redact(one.detail) })),
        trail: trail.runs(),
        log: postmortem.since(0).lines.slice(-MOST_LINES)
            .map((line) => ({ at: line.at, what: line.what, text: redact(String(line.text).split('\n')[0]) }))
    }
});

const asText = (made) => [`Tube ${made.version}`]
    .concat(Object.keys(made.report.facts).map((key) => `${key}: ${made.report.facts[key]}`))
    .concat(made.report.checks.map((one) => `${one.ok ? 'ok' : 'FAILED'} ${one.name}: ${one.detail}`))
    .concat((made.report.trail || []).map((run) => `run ${new Date(run.at).toISOString()} uptime ${run.uptime}s pid ${run.pid}: `
        + `${run.reached.map((one) => one.stage).join(' > ')}; ${run.ended ? run.ended.how : 'no ending recorded'}`))
    .concat(made.report.log.slice(-80).map((line) => `${new Date(line.at).toISOString().slice(11, 19)} ${line.what}: ${line.text}`))
    .join('\n');

module.exports = { bundle, asText };
