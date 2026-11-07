'use strict';

const dev = require('../dev/index.js');
const { lanAddresses, freshAddresses } = require('./serviceAddress.js');

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1)$/;

const GOOGLE = /(^|\.)(youtube\.com|googlevideo\.com|googleapis\.com|google\.com|ggpht\.com|gstatic\.com|googleusercontent\.com)$/;

const plain = (address) => String(address || '').replace(/^::ffff:/, '');

const listed = (name) => String(process.env[name] || '').split(',').map((one) => one.trim()).filter(Boolean);

const remoteOf = (req) => plain((req.socket || req.connection || {}).remoteAddress);

// The container reaches the service from one of this TV's own addresses; a phone on the LAN does not.
const fromThisTv = (req) => {
    if (dev.openProxy()) return true;

    const address = remoteOf(req);

    return LOOPBACK.test(address)
        || lanAddresses().indexOf(address) !== -1
        || freshAddresses().indexOf(address) !== -1
        || listed('TUBE_PROXY_CLIENTS').indexOf(address) !== -1;
};

const bypassAllows = (host) => {
    const name = String(host || '').split(':')[0].toLowerCase();

    return GOOGLE.test(name) || listed('TUBE_BYPASS_HOSTS').indexOf(name) !== -1;
};

module.exports = { fromThisTv, bypassAllows, remoteOf, GOOGLE };
