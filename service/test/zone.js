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

process.exit(results.every(Boolean) ? 0 : 1);
