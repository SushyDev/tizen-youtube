'use strict';

const ports = require('./ports.js');
const { switches } = require('./cobaltConfig.js');

// The container reaches nothing but the origin named in --base_url.
const servedHost = () => (/--base_url=http:\/\/([^/:\s"]+)/.exec(switches() || '') || [])[1] || null;

const PROXY_HOST = process.env.TUBE_PROXY_HOST || servedHost() || 'localhost';

const localOrigin = () => `http://${PROXY_HOST}:${ports.PROXY}`;

// What a redirect out of the bypass has to be prefixed with to come back through here.
const proxyPrefix = () => `${localOrigin()}/cors-bypass/`;

module.exports = { PROXY_HOST, localOrigin, proxyPrefix };
