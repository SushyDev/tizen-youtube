'use strict';

// What the boot screen is told on each ask.

const postmortem = require('./postmortem.js');
const reach = require('./reach.js');
const { facts } = require('./platform.js');

// What still stands before the handover, or null.
const waitingFor = (status) => {
    const network = reach.current();

    if (status.failed) return { tone: 'bad', what: `the service could not prepare Cobalt: ${status.failed}` };
    if (status.needsCertificate && !status.prepared) return { tone: 'warn', what: 'the service is preparing the certificate' };
    if (network.ok === false) return { tone: 'bad', what: `${network.host} is not reachable from the TV (${network.why})` };
    if (network.ok === null) return { tone: 'warn', what: `checking the connection to ${network.host}` };

    return null;
};

const firstLine = (text) => String(text).split('\n')[0];

const report = ({ since, status, script }) => {
    reach.check();

    const log = postmortem.since(Number(since) || 0);
    const waiting = waitingFor(status);

    return {
        facts: facts(script),
        ready: !waiting,
        waiting,
        log: log.lines.map((line) => ({ seq: line.seq, at: line.at, what: line.what, text: firstLine(line.text) })),
        next: log.next
    };
};

module.exports = { report };
