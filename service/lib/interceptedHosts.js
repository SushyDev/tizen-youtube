'use strict';

// The certificate has to cover exactly what the tunnel intercepts, or it serves names it does not
// cover, or is reissued on every start.
// googlevideo is deliberately absent: media is a blind tunnel.
const DOMAINS = ['youtube.com', 'google.com', 'googleapis.com', 'gstatic.com', 'ggpht.com'];

// reduce rather than flatMap: the legacy bundle runs on node 4.4.3.
const HOSTS = DOMAINS.reduce((all, domain) => all.concat(domain, `*.${domain}`), []);

module.exports = { DOMAINS, HOSTS };
