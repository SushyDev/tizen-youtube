'use strict';

const http = require('http');

const lookup = require('../lib/lookup.js');
const { send } = require('../lib/sending.js');

const results = [];

const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
};

// A recursive server's answer: the question, a CNAME, then the A record, names compressed.
const answer = (question) => {
    const header = Buffer.from(question.slice(0, 12));
    header.writeUInt16BE(0x8180, 2);
    header.writeUInt16BE(2, 6);

    const cname = Buffer.from([0xc0, 12, 0, 5, 0, 1, 0, 0, 1, 0, 0, 4, 1, 0x78, 0xc0, 12]);
    const record = Buffer.from([0xc0, 12, 0, 1, 0, 1, 0, 0, 1, 0, 0, 4, 142, 250, 74, 46]);

    return Buffer.concat([header, question.slice(12), cname, record]);
};

const asked = lookup.question(4660, 'www.youtube.com');

check('the question carries the id and one A query for the name',
    asked.readUInt16BE(0) === 4660 && asked.readUInt16BE(4) === 1
    && asked.toString('ascii', 13, 16) === 'www' && asked.readUInt16BE(asked.length - 4) === 1,
    asked.toString('hex'));

check('the A record is read past the question and the CNAME chain',
    lookup.firstAddress(answer(asked)) === '142.250.74.46', String(lookup.firstAddress(answer(asked))));

const noAnswer = Buffer.from(asked);
check('an answer without records gives nothing', lookup.firstAddress(noAnswer) === null, 'an address');

const seen = { host: null };

const upstream = http.createServer((req, res) => {
    seen.host = req.headers.host;

    if (req.url === '/moved') {
        res.writeHead(302, { location: '/landed' });
        return res.end();
    }

    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
});

upstream.listen(0, '127.0.0.1', () => {
    const port = upstream.address().port;
    const done = (code) => upstream.close(() => process.exit(code));
    const named = `up.example:${port}`;
    const real = lookup.resolve;

    Promise.all([lookup.resolve('127.0.0.1'), lookup.resolve('localhost')])
        .then(([address, bare]) => {
            check('an address and a bare name are left to the system', address === null && bare === null,
                `${address} | ${bare}`);

            lookup.resolve = (name) => Promise.resolve(name === 'up.example' ? '127.0.0.1' : null);

            return send(`http://${named}/plain`, { method: 'GET' }, { host: named });
        })
        .then((response) => {
            check('a resolved name is asked at its address, under its own name',
                response.status === 200 && seen.host === named, `${response.status} ${seen.host}`);

            return send(`http://${named}/moved`, { method: 'GET' }, { host: named });
        })
        .then((response) => {
            check('a relative redirect names the host, not the address it was asked at',
                response.headers.get('location') === `http://${named}/landed`, response.headers.get('location'));

            lookup.resolve = real;

            const failed = results.filter((ok) => !ok).length;
            console.log(`\n${results.length - failed}/${results.length} checks passed.`);
            done(failed ? 1 : 0);
        })
        .catch((error) => {
            console.error('Harness error:', error.message);
            done(1);
        });
});
