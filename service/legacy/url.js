'use strict';

// Below node 7 there is no url.URL, so node-fetch falls back to whatwg-url, whose tr46 refuses the
// rr2---sn- hosts googlevideo serves media from.

const url = require('url');

// Only what node-fetch reads: the href, its host name and its scheme.
function URL(input, base) {
    const href = base === undefined ? String(input) : url.resolve(String(base), String(input));
    const parsed = url.parse(href);

    if (!parsed.protocol || !parsed.hostname) throw new TypeError(`Invalid URL: ${href}`);

    this.href = url.format(parsed);
    this.protocol = parsed.protocol;
    this.hostname = parsed.hostname;
}

URL.prototype.toString = function toString() {
    return this.href;
};

module.exports = { URL };
