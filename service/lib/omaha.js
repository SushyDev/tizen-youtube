'use strict';

const http = require('http');
const https = require('https');

const APP_ID = '{6D4E53F3-CC64-4CB8-B6BD-AB0B8F300E1C}';
const ADDRESS = process.env.TUBE_OMAHA_URL || 'https://tools.google.com/service/update2/json';
const TIMEOUT = 20000;

// Omaha offers nothing unless every field is there, and the SABI must match the library byte for
// byte.
const requestFor = (query) => ({
    request: {
        protocol: '3.1',
        acceptformat: 'crx3',
        SABI: query.sabi,
        sbversion: (/"sb_api_version":(\d+)/.exec(query.sabi) || [])[1] || '',
        brand: 'Samsung',
        year: String(query.year),
        updaterchannel: query.channel || 'prod',
        app: [{ appid: APP_ID, version: query.version, updatecheck: {} }]
    }
});

const httpsFirst = (addresses) => addresses.filter((address) => address.indexOf('https:') === 0)
    .concat(addresses.filter((address) => address.indexOf('https:') !== 0));

// The reply opens with )]}' against JSON hijacking.
const offerOf = (text) => {
    const reply = JSON.parse(String(text).replace(/^\)\]\}'\s*/, ''));
    const app = ((reply.response && reply.response.app) || []).find((entry) => entry.appid === APP_ID);
    const check = app && app.updatecheck;
    if (!check || check.status !== 'ok' || !check.manifest) return null;

    const pkg = check.manifest.packages.package[0];

    return {
        version: check.manifest.version,
        name: pkg.name,
        size: pkg.size,
        sha256: pkg.hash_sha256,
        urls: httpsFirst(check.urls.url.map((entry) => `${entry.codebase}${pkg.name}`))
    };
};

const post = (body) => new Promise((resolve, reject) => {
    const client = ADDRESS.indexOf('http:') === 0 ? http : https;

    const request = client.request(ADDRESS, { method: 'POST', headers: { 'content-type': 'application/json' } }, (response) => {
        const parts = [];
        response.on('data', (chunk) => parts.push(chunk));
        response.on('end', () => (response.statusCode === 200
            ? resolve(Buffer.concat(parts).toString('utf8'))
            : reject(new Error(`Omaha answered ${response.statusCode}`))));
        response.on('error', reject);
    });

    request.setTimeout(TIMEOUT, () => request.destroy(new Error('Omaha timed out')));
    request.on('error', reject);
    request.end(JSON.stringify(body));
});

const ask = (query) => post(requestFor(query)).then(offerOf);

module.exports = { APP_ID, requestFor, offerOf, ask };
