'use strict';

// The address this service answers on, as the container has to see it.

const ports = require('./ports.js');

const PROXY_HOST = process.env.TUBE_PROXY_HOST || 'localhost';

const localOrigin = () => `http://${PROXY_HOST}:${ports.PROXY}`;

// What a redirect out of the bypass has to be prefixed with to come back through here.
const proxyPrefix = () => `${localOrigin()}/cors-bypass/`;

module.exports = { PROXY_HOST, localOrigin, proxyPrefix };
