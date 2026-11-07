'use strict';

const zone = require('../lib/zone.js');

const results = [];

const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
};

const BERLIN = { utcOffsetMinutes: 60, timeZone: 'Europe/Berlin' };

const sent = { host: 'www.youtube.com', 'x-youtube-utc-offset': '0' };
const corrected = zone.correctHeaders(sent, BERLIN);
check('the page\'s offset header carries the set\'s offset', corrected['x-youtube-utc-offset'] === '60', JSON.stringify(corrected));
check('the zone is named beside it', corrected['x-youtube-time-zone'] === 'Europe/Berlin', JSON.stringify(corrected));
check('other headers are kept', corrected.host === 'www.youtube.com', JSON.stringify(corrected));

const plain = { host: 'i.ytimg.com' };
check('a request that named no zone is left alone', zone.correctHeaders(plain, BERLIN) === plain, '');

const unnamed = zone.correctHeaders(sent, { utcOffsetMinutes: 60, timeZone: null });
check('without a name only the offset changes', !('x-youtube-time-zone' in unnamed) && unnamed['x-youtube-utc-offset'] === '60',
    JSON.stringify(unnamed));

const here = zone.current();
check('the service reads its own offset', here.utcOffsetMinutes === -new Date().getTimezoneOffset(), JSON.stringify(here));

const tag = zone.pageTag(BERLIN);
check('the page tag hands the zone over', tag === '<script>window.__TUBE_ZONE__={"utcOffsetMinutes":60,"timeZone":"Europe/Berlin"};</script>', tag);

const zlib = require('zlib');
const { PassThrough } = require('stream');

const at = (body) => JSON.parse(zone.correctBody(JSON.stringify(body), BERLIN));
const fixed = at({ context: { client: { clientName: 'TVHTML5', utcOffsetMinutes: 0 } }, videoId: 'x' });
check('a body\'s client context gets the set\'s offset and zone',
    fixed.context.client.utcOffsetMinutes === 60 && fixed.context.client.timeZone === 'Europe/Berlin'
        && fixed.context.client.clientName === 'TVHTML5' && fixed.videoId === 'x', JSON.stringify(fixed));
check('a body without a client context is left as it was', zone.correctBody('{"a":1}', BERLIN) === '{"a":1}', '');
check('a body that is not JSON is left as it was', zone.correctBody('\u0000raw', BERLIN) === '\u0000raw', '');

check('innertube POSTs are read, others are not',
    zone.carriesContext('POST', 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false')
        && !zone.carriesContext('GET', 'https://www.youtube.com/youtubei/v1/player')
        && !zone.carriesContext('POST', 'https://rr1---sn-x.googlevideo.com/videoplayback'), '');

const request = (bytes) => {
    const req = new PassThrough();
    req.end(bytes);
    return req;
};

const body = JSON.stringify({ context: { client: { utcOffsetMinutes: 0 } } });
const gzipped = zlib.gzipSync(body);

Promise.all([
    zone.correctRequest(request(gzipped), { 'content-encoding': 'gzip', 'content-length': String(gzipped.length), host: 'www.youtube.com' }, BERLIN),
    zone.correctRequest(request(body), { 'content-length': String(body.length) }, BERLIN),
    zone.correctRequest(request('xyz'), { 'content-encoding': 'br' }, BERLIN)
]).then((answers) => {
    const unzipped = answers[0];
    const sent = JSON.parse(unzipped.body.toString('utf8'));
    check('a gzipped body is sent plain and corrected', sent.context.client.utcOffsetMinutes === 60
        && !('content-encoding' in unzipped.headers) && unzipped.headers['content-length'] === String(unzipped.body.length)
        && unzipped.headers.host === 'www.youtube.com', JSON.stringify(unzipped.headers));

    const plain = answers[1];
    check('a plain body is corrected with its length', JSON.parse(plain.body.toString('utf8')).context.client.timeZone === 'Europe/Berlin'
        && plain.headers['content-length'] === String(plain.body.length), JSON.stringify(plain.headers));

    const unread = answers[2];
    check('a body in an encoding it can\'t read goes on as it came', unread.body.toString('utf8') === 'xyz'
        && unread.headers['content-encoding'] === 'br', JSON.stringify(unread.headers));

    process.exit(results.every(Boolean) ? 0 : 1);
}, (error) => {
    check('bodies are read', false, String(error));
    process.exit(1);
});
