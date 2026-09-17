'use strict';

// A CRX3 package's content/ files, taken only once the package matches the SHA-256 Omaha offered.

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const url = require('url');
const zlib = require('zlib');

const { TAIL, endOf, entriesOf, dataOf } = require('./zipIndex.js');

const PREFIX = 'content/';
const STORED = 0;
const DEFLATED = 8;
const TIMEOUT = 60000;
const MOST_REDIRECTS = 4;

const download = (address, redirects) => new Promise((resolve, reject) => {
    const client = address.indexOf('http:') === 0 ? http : https;

    const request = client.get(address, (response) => {
        const moved = response.statusCode >= 300 && response.statusCode < 400 && response.headers.location;

        if (moved) {
            response.resume();
            if ((redirects || 0) >= MOST_REDIRECTS) return reject(new Error(`too many redirects for ${address}`));
            return resolve(download(url.resolve(address, response.headers.location), (redirects || 0) + 1));
        }

        if (response.statusCode !== 200) {
            response.resume();
            return reject(new Error(`HTTP ${response.statusCode} for ${address}`));
        }

        const parts = [];
        response.on('data', (chunk) => parts.push(chunk));
        response.on('end', () => resolve(Buffer.concat(parts)));
        return response.on('error', reject);
    });

    request.setTimeout(TIMEOUT, () => request.destroy(new Error(`timed out on ${address}`)));
    request.on('error', reject);
});

// "Cr24", the format version, and the header's length; the zip follows the header.
const zipOf = (crx) => {
    if (crx.toString('latin1', 0, 4) !== 'Cr24') throw new Error('not a CRX package');
    return crx.slice(12 + crx.readUInt32LE(8));
};

const unpack = (zip, entry) => {
    if (entry.method !== DEFLATED && entry.method !== STORED) throw new Error(`zip: ${entry.name} uses method ${entry.method}`);

    const packed = dataOf(zip, entry.local, entry);
    return entry.method === DEFLATED ? zlib.inflateRawSync(packed) : packed;
};

// Every file under content/, as { name, data } with the name relative to content/.
const contentOf = (address, sha256) => download(address).then((crx) => {
    const hash = crypto.createHash('sha256').update(crx).digest('hex');
    if (hash !== String(sha256).toLowerCase()) throw new Error(`${address} does not match the SHA-256 it was offered with`);

    const zip = zipOf(crx);
    const end = endOf(zip.slice(Math.max(0, zip.length - TAIL)));

    return entriesOf(zip.slice(end.offset, end.offset + end.size), end.count)
        .filter((entry) => entry.name.indexOf(PREFIX) === 0 && !/\/$/.test(entry.name))
        .map((entry) => ({ name: entry.name.slice(PREFIX.length), data: unpack(zip, entry) }));
});

module.exports = { contentOf };
