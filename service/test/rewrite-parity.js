'use strict';

// Differential test: our rewrite table must transform text identically to the
// reference implementation. The one intended difference is the injected script tag,
// which points at this service instead of a CDN, and is compared separately.

const { rewriteBody, rewriteSetCookie } = require('../lib/proxy.js');

const PORT = 8099;
const proxyPrefix = `http://localhost:${PORT}/cors-bypass/`;

// Lifted from TizenTube/standalone/service/index.js:145-176.
function referenceRewrite(text, url) {
    text = text.replace(/https:\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `${proxyPrefix}https://$1.googlevideo.com`);
    text = text.replace(/https:\\\/\\\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `http:\\\/\\\/localhost:${PORT}\\\/cors-bypass\\\/https:\\\/\\\/$1.googlevideo.com`);
    text = text.replace(/"\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `"${proxyPrefix}https://$1.googlevideo.com`);
    text = text.replace(/https:\/\/www\.gstatic\.com/g, `${proxyPrefix}https://www.gstatic.com`);
    text = text.replace(/http:\/\/www\.gstatic\.com/g, `${proxyPrefix}https://www.gstatic.com`);
    text = text.replace(/"\/\/www\.gstatic\.com/g, `"${proxyPrefix}https://www.gstatic.com`);
    text = text.replace(/\(\/\/www\.gstatic\.com/g, `(${proxyPrefix}https://www.gstatic.com`);
    text = text.replace(/https:\/\/yt3\.ggpht\.com/g, `${proxyPrefix}https://yt3.ggpht.com`);
    text = text.replace(/https:\/\/clients1\.google\.com/g, `${proxyPrefix}https://clients1.google.com`);
    text = text.replace(/http:\/\/clients1\.google\.com/g, `${proxyPrefix}https://clients1.google.com`);
    text = text.replace(/"\/\/clients1\.google\.com/g, `"${proxyPrefix}https://clients1.google.com`);
    text = text.replace('Set(["www.youtube.com","accounts.google.com"]);', 'Set(["www.youtube.com", "accounts.google.com", "localhost"]);');
    text = text.replace(/:document\.location\.toString\(\)/g, ':document.location.toString().replace("http://localhost:8099", "https://www.youtube.com")');
    text = text.replace(/euri:[^,]+,/g, 'euri:document.location.toString().replace("http://localhost:8099", "https://www.youtube.com"),');
    text = text.replace(/https:\/\/s\.youtube\.com/g, `${proxyPrefix}https://s.youtube.com`);
    text = text.replace(/redirector.googlevideo.com/g, `${proxyPrefix}https://redirector.googlevideo.com`);
    text = text.replace(/this.scheme="https"/, 'this.scheme="http"');
    text = text.replace(/https\:\/\/jnn-pa.googleapis.com/g, `${proxyPrefix}https://jnn-pa.googleapis.com`);
    text = text.replace(/https:\/\/yt3\.googleusercontent\.com/g, `${proxyPrefix}https://yt3.googleusercontent.com`);
    text = text.replace(/"\/\/yt3\.googleusercontent\.com/g, `"${proxyPrefix}https://yt3.googleusercontent.com`);
    text = text.replace(/=window\.location\.href;/, '=window.location.href.replace("http://localhost:8099", "https://www.youtube.com");');
    text = text.replace(/=document\.location\.href/, '=document.location.href.replace("http://localhost:8099", "https://www.youtube.com")');
    return text;
}

const SAMPLES = [
    ['absolute googlevideo', 'var u="https://r5---sn-abc.googlevideo.com/videoplayback?x=1";'],
    ['escaped googlevideo', 'var u="https:\\/\\/r5---sn-abc.googlevideo.com\\/videoplayback";'],
    ['protocol-relative gv', 'src="//r1---sn-xyz.googlevideo.com/foo"'],
    ['gstatic all forms', 'a="https://www.gstatic.com/x";b="http://www.gstatic.com/y";c="//www.gstatic.com/z";d=(//www.gstatic.com/w'],
    ['ggpht + usercontent', 'i="https://yt3.ggpht.com/a";j="https://yt3.googleusercontent.com/b";k="//yt3.googleusercontent.com/c"'],
    ['clients1 all forms', 'p="https://clients1.google.com/a";q="http://clients1.google.com/b";r="//clients1.google.com/c"'],
    ['origin allowlist', 'var o=new Set(["www.youtube.com","accounts.google.com"]);'],
    ['location toString', 'var x={u:document.location.toString()};'],
    ['euri field', 'ping({euri:"https://www.youtube.com/tv",foo:1})'],
    ['s.youtube + redirector', 'a="https://s.youtube.com/api";b="redirector.googlevideo.com"'],
    ['player scheme', 'this.scheme="https";this.host="x"'],
    ['jnn-pa', 'f("https://jnn-pa.googleapis.com/v1/attest")'],
    ['history href', 'var a=window.location.href;var b=document.location.href;'],
    ['mixed realistic blob', 'this.scheme="https";var s=new Set(["www.youtube.com","accounts.google.com"]);var v="https://r1---sn-q.googlevideo.com/vp";var g="//www.gstatic.com/img.png";var h=window.location.href;'],
    ['no-op text', 'const totallyUnrelated = { a: 1, b: "hello world" };']
];

let failures = 0;

SAMPLES.forEach(function (pair) {
    const label = pair[0];
    const input = pair[1];

    // A URL that does NOT get a script tag, isolating the table.
    const ours = rewriteBody(input, '/watch');
    const theirs = referenceRewrite(input, '/watch');

    if (ours === theirs) {
        console.log(`PASS  ${label}`);
    } else {
        failures++;
        console.log(`FAIL  ${label}`);
        console.log(`        ours: ${ours}`);
        console.log(`      theirs: ${theirs}`);
    }
});

// The intended divergence: the injected tag is local, not a CDN.
const injected = rewriteBody('<html></html>', '/tv');
const usesLocal = injected.indexOf('http://localhost:8099/__tube/userScript.js') !== -1;
const usesCdn = injected.indexOf('jsdelivr') !== -1;
console.log(`${usesLocal && !usesCdn ? 'PASS' : 'FAIL'}  /tv gets a locally served script tag, not a CDN one`);
if (!usesLocal || usesCdn) failures++;

const noTag = rewriteBody('<html></html>', '/tv_config');
console.log(`${noTag.indexOf('__tube') === -1 ? 'PASS' : 'FAIL'}  /tv_config is not injected into`);
if (noTag.indexOf('__tube') !== -1) failures++;

const cookies = rewriteSetCookie(['__Secure-3PSID=abc; Domain=.youtube.com; Secure; SameSite=None; Path=/']);

// Cookie prefixes: check for the `Secure` *attribute*, not the substring — the renamed
// prefix __LocalSecure- legitimately contains it.
const attributes = cookies[0].split(/;\s*/).slice(1);
const ok = cookies[0].indexOf('__LocalSecure-3PSID') === 0 &&
    attributes.indexOf('Domain=localhost') !== -1 &&
    attributes.indexOf('Secure') === -1 &&
    attributes.indexOf('SameSite=None') === -1;
console.log(`${ok ? 'PASS' : 'FAIL'}  __Secure- cookie is renamed and de-secured  ${ok ? '' : cookies[0]}`);
if (!ok) failures++;

console.log(`\n${failures === 0 ? 'All rewrite rules match the reference.' : failures + ' mismatch(es).'}`);
process.exit(failures ? 1 : 0);
