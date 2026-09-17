'use strict';

// The hosts we stand in front of, in one place.
//
// The certificate has to cover exactly what the tunnel intercepts: a domain in one list and not
// the other is either a certificate that does not cover what we serve, or one reissued on every
// start. Until this file, the relationship was written down only in service/test/x509.js.
//
// googlevideo is deliberately absent: media is a blind tunnel, and standing in front of it buys
// nothing but latency.
const DOMAINS = ['youtube.com', 'google.com', 'googleapis.com', 'gstatic.com', 'ggpht.com'];

// Each domain and its wildcard, which is the shape a certificate's SAN list wants.
// reduce rather than flatMap: the legacy bundle runs on node 4.4.3.
const HOSTS = DOMAINS.reduce((all, domain) => all.concat(domain, `*.${domain}`), []);

module.exports = { DOMAINS, HOSTS };
