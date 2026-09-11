'use strict';

// Runs one expression in a page carrying the dev bridge and returns what it evaluated to.

const http = require('http');

// The service's own override, so the Cobalt suite can run a bridge beside a set's without either
// answering for the other.
const PORT = Number(process.env.TUBE_DEV_PORT) || 8097;
const ANSWER_SECONDS = 20;

const ask = (where, options, body) => new Promise((resolve, reject) => {
    const request = http.request(
        Object.assign({ host: where.tv, port: PORT, timeout: (ANSWER_SECONDS + 5) * 1000 }, options),
        (response) => {
            const parts = [];
            response.on('data', (chunk) => parts.push(chunk));
            response.on('end', () => {
                const text = Buffer.concat(parts).toString('utf8');
                try {
                    resolve(JSON.parse(text));
                } catch (e) {
                    resolve(text);
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

    if (body) request.write(body);
    request.end();
});

const flag = (name) => {
    const found = process.argv.indexOf(name);
    return found === -1 ? undefined : process.argv[found + 1];
};

const settings = () => ({
    tv: flag('--tv') || process.env.TUBE_TV,
    token: process.env.TUBE_DEV_TOKEN
});

const evaluate = async (source, where) => {
    const at = where || settings();

    if (!at.tv || !at.token) {
        throw Object.assign(new Error('No set to ask.\n'
            + '  Name it with --tv <address> or TUBE_TV, and give its bridge token as TUBE_DEV_TOKEN.'),
        { isFriendly: true });
    }

    const answer = await ask(at, {
        method: 'POST',
        path: `/eval?seconds=${ANSWER_SECONDS}`,
        headers: { 'content-type': 'text/plain', 'x-tube-token': at.token }
    }, source);

    if (answer.error) throw Object.assign(new Error(answer.error), { isFriendly: true });

    return answer.value;
};

module.exports = { evaluate, settings, PORT };
