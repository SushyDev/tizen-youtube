'use strict';

const forward = require('../lib/forward.js');

let failures = 0;

function check(label, ok, detail) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  ${detail}`}`);
    if (!ok) failures += 1;
}

const normalised = (url) => {
    const req = { url };
    forward.normaliseSelf(req, 'tv.example', 8099);
    return req.url;
};

[
    ['our host and port', 'http://tv.example:8099/tv?x=1', '/tv?x=1'],
    ['our host without its port', 'http://tv.example/tv', '/tv'],
    ['localhost', 'http://localhost:8099/__tube/state', '/__tube/state'],
    ['loopback without a port', 'http://127.0.0.1/tv', '/tv'],
    ['our host with no path', 'http://tv.example:8099', '/']
].forEach(([label, url, path]) => {
    check(`${label} becomes a path`, normalised(url) === path, normalised(url));
});

[
    ['another host', 'http://www.youtube.com/tv'],
    ['another port on our host', 'http://tv.example:9000/tv'],
    ['a path', '/tv']
].forEach(([label, url]) => {
    check(`${label} is left as it was`, normalised(url) === url, normalised(url));
});

check('an absolute URL is a forward target',
    forward.absoluteTarget('https://www.youtube.com/tv') === 'https://www.youtube.com/tv');
check('a path is not a forward target', forward.absoluteTarget('/tv') === null);

console.log(failures ? `\n${failures} failed.` : '\nall checks passed');
process.exit(failures ? 1 : 0);
