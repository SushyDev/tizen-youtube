'use strict';

// Which address of this set the container is sent to; never its hostname, which the container
// cannot resolve even on a set where the service can.

const os = require('os');

// Held briefly: asked once per request and again per match in the page rewrites, but a new lease
// still has to be followed.
const FRESH_FOR = 5000;

const held = { at: 0, addresses: null };

// node 18.0 to 18.3 name the family 4.
const readAddresses = () => {
    const interfaces = os.networkInterfaces();

    return Object.keys(interfaces).reduce((all, device) => all.concat(interfaces[device]
        .filter((entry) => !entry.internal && (entry.family === 'IPv4' || entry.family === 4))
        .map((entry) => entry.address)), []);
};

const lanAddresses = () => {
    const now = Date.now();

    if (held.addresses && now - held.at < FRESH_FOR) return held.addresses;

    held.at = now;
    held.addresses = readAddresses();

    return held.addresses;
};

// Loopback only off a television, where nothing else is listening.
const serviceAddress = () => lanAddresses()[0] || '127.0.0.1';

module.exports = { lanAddresses, serviceAddress };
