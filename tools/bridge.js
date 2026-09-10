'use strict';

// Running one expression in the page on a television, and reading back what it returned.
//
// The debug build opens this on port 8097. There is no response to the command itself: the page
// runs it on its next tick and carries the answer out in the reading that /stats serves, so it is
// asked for and then waited for.

const http = require('http');

const PORT = 8097;
const TRIES = 14;
const APART = 700;

const ask = (where, options, body) => new Promise((resolve, reject) => {
    const request = http.request(
        Object.assign({ host: where.tv, port: PORT, timeout: 10000 }, options),
        (response) => {
            const parts = [];
            response.on('data', (chunk) => parts.push(chunk));
            response.on('end', () => {
                try {
                    resolve(JSON.parse(parts.join('')));
                } catch (e) {
                    resolve(parts.join(''));
                }
            });
        }
    );

    request.on('error', reject);
    request.on('timeout', () => {
        request.destroy();
        reject(Object.assign(new Error(`${where.tv}:${PORT} did not answer.\n`
            + '  A debug build has to be running on the set:\n'
            + '    TUBE_DEV=1 TUBE_DEV_TOKEN=<token> npm run package, then install and open the app.'),
        { isFriendly: true }));
    });

    if (body) request.write(JSON.stringify(body));
    request.end();
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const settings = () => ({
    tv: process.env.TUBE_TV || '192.168.1.29',
    token: process.env.TUBE_DEV_TOKEN || 'tvdebug2026'
});

// Matched on the source it was asked with, so a reading left over from something else is not read
// as this one's answer.
const evaluate = async (source, where) => {
    const at = where || settings();

    await ask(at, {
        method: 'POST',
        path: '/command',
        headers: { 'content-type': 'application/json', 'x-tube-token': at.token }
    }, { action: 'eval', source });

    const answer = await Array.from({ length: TRIES }).reduce(async (found) => {
        const already = await found;
        if (already) return already;

        await wait(APART);
        const stats = await ask(at, { method: 'GET', path: '/stats' });
        const ran = stats && stats.reading && stats.reading.evaluated;

        return ran && ran.source === source ? ran : null;
    }, Promise.resolve(null));

    if (!answer) {
        throw Object.assign(new Error('The page did not answer.\n'
            + '  It has to be open on the set, and the build has to carry the dev bridge.'),
        { isFriendly: true });
    }

    if (answer.error) throw Object.assign(new Error(answer.error), { isFriendly: true });

    return answer.value;
};

module.exports = { evaluate, settings };
