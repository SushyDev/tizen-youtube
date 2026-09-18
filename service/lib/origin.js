'use strict';

const os = require('os');

const ports = require('./ports.js');
const { switches } = require('./cobaltConfig.js');

// The container reaches nothing but the origin named in --base_url.
const servedHost = () => (/--base_url=http:\/\/([^/:\s"]+)/.exec(switches() || '') || [])[1] || null;

// A file:// base_url names no host, and the container cannot fetch a localhost URL.
const lanAddress = () => {
    const interfaces = os.networkInterfaces();

    return Object.keys(interfaces).reduce((all, device) => all.concat(interfaces[device]
        .filter((entry) => !entry.internal && (entry.family === 'IPv4' || entry.family === 4))
        .map((entry) => entry.address)), [])[0] || null;
};

const PROXY_HOST = process.env.TUBE_PROXY_HOST || servedHost() || lanAddress() || 'localhost';

const localOrigin = () => `http://${PROXY_HOST}:${ports.PROXY}`;

// What a redirect out of the bypass has to be prefixed with to come back through here.
const proxyPrefix = () => `${localOrigin()}/cors-bypass/`;

module.exports = { PROXY_HOST, localOrigin, proxyPrefix };
