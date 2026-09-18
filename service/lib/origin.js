'use strict';

const ports = require('./ports.js');
const { switches } = require('./cobaltConfig.js');
const { serviceAddress } = require('./serviceAddress.js');

// The container reaches nothing but the origin named in --base_url.
const servedHost = () => (/--base_url=http:\/\/([^/:\s"]+)/.exec(switches() || '') || [])[1] || null;

// Asked each time: DHCP can change this set's address while the service runs.
const proxyHost = () => process.env.TUBE_PROXY_HOST || servedHost() || serviceAddress();

const localOrigin = () => `http://${proxyHost()}:${ports.PROXY}`;

// What a redirect out of the bypass has to be prefixed with to come back through here.
const proxyPrefix = () => `${localOrigin()}/cors-bypass/`;

module.exports = { proxyHost, localOrigin, proxyPrefix };
