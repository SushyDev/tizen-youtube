'use strict';

// The address this service answers on, as the container has to see it.

const ports = require('./ports.js');
const { switches } = require('./cobaltConfig.js');

// A build that serves the page itself names its own origin in --base_url; the container reaches nothing else.
const servedHost = () => (/--base_url=http:\/\/([^/:\s"]+)/.exec(switches() || '') || [])[1] || null;

const PROXY_HOST = process.env.TUBE_PROXY_HOST || servedHost() || 'localhost';

const localOrigin = () => `http://${PROXY_HOST}:${ports.PROXY}`;

// What a redirect out of the bypass has to be prefixed with to come back through here.
const proxyPrefix = () => `${localOrigin()}/cors-bypass/`;

module.exports = { PROXY_HOST, localOrigin, proxyPrefix };
