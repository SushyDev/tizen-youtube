const REAL = 'http://127.0.0.2:8099';

const page = { href: `${REAL}/tv?launch=menu#/watch?v=x`, assigned: [], urlGets: 0 };

// Cobalt 20's shape: every part of location is an own, configurable accessor.
const location = {};
const accessor = (key, get, set) => Object.defineProperty(location, key, { configurable: true, enumerable: true, get, set });
accessor('href', () => page.href, (value) => { page.assigned.push(String(value)); page.href = String(value); });
accessor('origin', () => REAL);
accessor('protocol', () => 'http:');
accessor('host', () => '127.0.0.2:8099');
accessor('hostname', () => '127.0.0.2');
accessor('port', () => '8099');
accessor('hash', () => page.href.slice(page.href.indexOf('#')));
location.assign = (url) => page.assigned.push(`assign ${url}`);
location.replace = (url) => page.assigned.push(`replace ${url}`);

function Document() {}
Object.defineProperty(Document.prototype, 'URL', { configurable: true, enumerable: true, get() { return page.href; } });

global.document = new Document();
global.window = { location, Document };

const { presentAsYouTube, realOrigin } = await import('../mods/network/pageOrigin.js');
const { redirectUrl } = await import('../mods/network/originRewrite.js');

const results = [];

const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
};

check('it takes over a forgeable location', presentAsYouTube() === true, 'refused');
check('and only once', presentAsYouTube() === false, 'ran twice');

check('the origin reads as YouTube', location.origin === 'https://www.youtube.com', location.origin);
check('so does the host name', location.hostname === 'www.youtube.com' && location.host === 'www.youtube.com', location.hostname);
check('and the scheme', location.protocol === 'https:' && location.port === '', location.protocol);
check('href keeps its path, query and route',
    location.href === 'https://www.youtube.com/tv?launch=menu#/watch?v=x', location.href);
check('the route itself is untouched', location.hash === '#/watch?v=x', location.hash);
check('toString agrees with href', String(location) === location.href, String(location));
check('document.URL agrees too', document.URL === location.href, document.URL);

check('the real origin is still known', realOrigin() === REAL, realOrigin());
check('googlevideo still goes through the real service',
    redirectUrl('https://rr1---sn-a.googlevideo.com/videoplayback?x=1')
        === `${REAL}/cors-bypass/https://rr1---sn-a.googlevideo.com/videoplayback?x=1`,
    redirectUrl('https://rr1---sn-a.googlevideo.com/videoplayback?x=1'));
check('a YouTube URL built from the presented origin comes home',
    redirectUrl(`${location.origin}/api/jnn/v1/GenerateIT`) === `${REAL}/api/jnn/v1/GenerateIT`,
    redirectUrl(`${location.origin}/api/jnn/v1/GenerateIT`));

location.href = 'https://www.youtube.com/tv#/browse';
location.assign('https://www.youtube.com/tv#/a');
location.replace('https://www.youtube.com/tv#/b');
check('navigating to the presented origin stays on the real one',
    page.assigned.join(' | ') === `${REAL}/tv#/browse | assign ${REAL}/tv#/a | replace ${REAL}/tv#/b`, page.assigned.join(' | '));

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
