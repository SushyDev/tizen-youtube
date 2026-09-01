'use strict';

// DEVELOPMENT ONLY: `npm run dev` runs this instead of `../index.js`.
//
// Off a TV there is no sdb daemon and so no debugger to inject with. The proxy is the
// stand-in: youtube.com served from localhost with a script tag spliced in. Attaching
// it here rather than in the shipped service is what keeps it off the television.

const service = require('../lib/service.js');
const proxy = require('./proxy.js');

// Before the catch-all, after the service's own routes — `attachDev` registers both,
// in that order, and `service/test/routing.js` pins it: reversed, /__tube/state is
// answered with YouTube's HTML and the app never launches.
proxy.attachDev(service.app, service.platformVersion);

service.start();
