'use strict';

// What the userscript costs, measured rather than reasoned about.
//
// Two numbers matter, because the userscript imposes two different kinds of cost:
//
//   json  Every screen arrives through JSON.parse and this app owns that function, so
//         each response pays for whatever the readers do. Measured against the native
//         parse of the same bytes, which is the floor.
//   dom   Anything observing the document is charged for YouTube's rendering, not its
//         own work: Blink allocates a MutationRecord per node touched inside an observed
//         subtree whether or not the callback looks at it. Measured as the cost of node
//         churn with the script loaded against the same churn without it.
//
// Needs Chromium and playwright-core, neither of which is a dependency of this repo
// because neither is needed to build or ship it:
//
//     npm i --no-save playwright-core
//     node tools/bench.js                    # both measurements
//     node tools/bench.js --profile          # where the json time goes
//     node tools/bench.js --bundle <path>    # compare against another build
//
// Comparing two builds is the point — build one, stash it, build the other, and run
// this against each. The absolute numbers are desktop numbers and a television is far
// slower; the ratio is what carries over.

const http = require('http');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const { ROOT } = require('./config.js');
const ui = require('./ui.js');

const args = process.argv.slice(2);
const flag = (name) => args.indexOf(name) !== -1;
const value = (name, fallback) => {
    const at = args.indexOf(name);
    return at !== -1 && args[at + 1] ? args[at + 1] : fallback;
};

const BUNDLE = value('--bundle', join(ROOT, 'dist', 'userScript.modern.js'));
const SHELVES = Number(value('--shelves', 12));
const TILES = Number(value('--tiles', 15));

function chromium() {
    let playwright;
    try {
        playwright = require('playwright-core');
    } catch (e) {
        console.error('playwright-core is not installed.\n  npm i --no-save playwright-core');
        process.exit(1);
    }

    // Where the image in Claude Code on the web keeps it; otherwise let playwright look.
    const bundled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
    const executablePath = process.env.CHROME_PATH
        || (existsSync(bundled) ? bundled : undefined);

    return { playwright, executablePath };
}

const PAGE = `<!doctype html><html><head><style nonce="x"></style></head><body>
<video></video><ytlr-search-bar></ytlr-search-bar>
<ytlr-progress-bar hybridnavfocusable="true"></ytlr-progress-bar>
<div id="stage"></div></body></html>`;

function serve(source) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            if (req.url.indexOf('/userScript.js') === 0) {
                res.setHeader('content-type', 'application/javascript');
                return res.end(source);
            }
            res.setHeader('content-type', 'text/html');
            res.end(PAGE);
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

// Enough of YouTube's registry that the modules walking it on load do not throw. An
// exception anywhere in core.js aborts module evaluation before interceptJson() runs,
// and every number below would then quietly be a measurement of the native function.
const STUBS = () => {
    const icons = new Map([['CLEAR_COOKIES', 'a'], ['MICROPHONE_ON', 'b']]);
    const services = new Map([
        ['PlayerService', { loadedPlaybackConfig: { watchEndpoint: {} }, loadVideo() {} }],
        ['PlaybackPreviewService', { start() {}, stop() {} }]
    ]);
    services.mappings = true;
    window._yttv = { a: icons, b: services };
    window.tectonicConfig = { featureSwitches: {}, clientData: {} };
    window.queuedVideos = { videos: [], lastVideoId: null };
};

// A structurally realistic browse response. The handlers walk this shape, so the cost is
// proportional to it; a flat fixture would measure nothing.
const FIXTURE = (shelves, tiles) => {
    const tile = (i) => ({
        tileRenderer: {
            contentId: `videoId${i}`,
            style: 'TILE_STYLE_YTLR_DEFAULT',
            trackingParams: 'CBQQ__abcdef',
            header: {
                tileHeaderRenderer: {
                    thumbnail: {
                        thumbnails: [
                            { url: `https://i.ytimg.com/vi/v${i}/hq.jpg?sqp=abc`, width: 480, height: 360 },
                            { url: `https://i.ytimg.com/vi/v${i}/mq.jpg?sqp=abc`, width: 320, height: 180 }
                        ]
                    },
                    thumbnailOverlays: [
                        { thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: 10 } }
                    ]
                }
            },
            metadata: {
                tileMetadataRenderer: {
                    title: { simpleText: `A video title number ${i} that is reasonably long` },
                    lines: [{ lineRenderer: { items: [{ lineItemRenderer: { text: { runs: [{ text: `Channel ${i}` }] } } }] } }]
                }
            },
            onSelectCommand: {
                clickTrackingParams: 'CBQQ_____',
                commandMetadata: { webCommandMetadata: { url: `/watch?v=v${i}` } },
                watchEndpoint: { videoId: `videoId${i}`, params: 'ChcKC' }
            },
            onLongPressCommand: {
                showMenuCommand: {
                    menu: { menuRenderer: { items: [{ menuServiceItemRenderer: { text: { simpleText: 'Not interested' } } }] } }
                }
            }
        }
    });

    const shelf = (s) => ({
        shelfRenderer: {
            title: { simpleText: `Shelf ${s}` },
            content: { horizontalListRenderer: { items: Array.from({ length: tiles }, (_, i) => tile(s * 100 + i)) } }
        }
    });

    return {
        responseContext: { visitorData: 'abc' },
        contents: {
            tvBrowseRenderer: {
                content: {
                    tvSurfaceContentRenderer: {
                        content: { sectionListRenderer: { contents: Array.from({ length: shelves }, (_, s) => shelf(s)) } }
                    }
                }
            }
        }
    };
};

function loadScript(port) {
    return new Promise((resolve, reject) => {
        const element = document.createElement('script');
        element.src = `http://127.0.0.1:${port}/userScript.js`;
        element.onload = resolve;
        element.onerror = reject;
        document.head.appendChild(element);
    });
}

async function run() {
    if (!existsSync(BUNDLE)) {
        console.error(`No bundle at ${BUNDLE} — run \`npm run build\` first.`);
        process.exit(1);
    }

    const { playwright, executablePath } = chromium();
    const server = await serve(readFileSync(BUNDLE, 'utf8'));
    const port = server.address().port;

    const browser = await playwright.chromium.launch({ executablePath, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(STUBS);

    // --- dom: measured before the script exists, then after, on the same page.
    const churn = () => page.evaluate(async () => {
        const stage = document.getElementById('stage');
        const ROUNDS = 300;
        const NODES = 40;

        await new Promise((r) => setTimeout(r, 50));

        const started = performance.now();
        for (let round = 0; round < ROUNDS; round++) {
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < NODES; i++) {
                const node = document.createElement('div');
                node.className = 'tile';
                node.appendChild(document.createElement('span'));
                fragment.appendChild(node);
            }
            stage.appendChild(fragment);
            while (stage.firstChild) stage.removeChild(stage.firstChild);
        }
        const elapsed = performance.now() - started;

        // Observer callbacks and record delivery land in microtasks.
        await new Promise((r) => setTimeout(r, 0));
        return { elapsed, mutations: ROUNDS * NODES * 2 };
    });

    const domBare = await churn();

    const json = await page.evaluate(async ({ port, fixture, load }) => {
        // Captured before the bundle runs, so these are genuinely unpatched.
        const nativeParse = JSON.parse;
        const nativeStringify = JSON.stringify;

        const text = nativeStringify(fixture);
        const boring = nativeStringify({ responseContext: { visitorData: 'abc' }, other: [1, 2, 3], nested: { a: 1, b: 2 } });

        const evalStarted = performance.now();
        await new Function('port', `return (${load})(port)`)(port);
        const evalMs = performance.now() - evalStarted;

        const patched = JSON.parse !== nativeParse && JSON.stringify !== nativeStringify;

        const time = (fn, iterations) => {
            for (let i = 0; i < Math.max(3, iterations / 10); i++) fn();
            const started = performance.now();
            for (let i = 0; i < iterations; i++) fn();
            return (performance.now() - started) / iterations;
        };

        // A decorated response has to stay serialisable. A menu item whose payload is
        // the tile the menu lives in is a cycle: it throws here and recurses forever in
        // any deep copy. Cheap to reintroduce by accident, so it is checked every run.
        let acyclic = true;
        try {
            nativeStringify(JSON.parse(text));
        } catch (e) {
            acyclic = false;
        }

        const decorated = JSON.parse(text).contents.tvBrowseRenderer.content
            .tvSurfaceContentRenderer.content.sectionListRenderer.contents[0]
            .shelfRenderer.content.horizontalListRenderer.items[0].tileRenderer;

        const queued = decorated.onLongPressCommand?.showMenuCommand?.menu?.menuRenderer?.items
            ?.find((m) => m?.menuServiceItemRenderer?.serviceEndpoint?.playlistEditEndpoint
                ?.customAction?.action === 'ADD_TO_QUEUE')
            ?.menuServiceItemRenderer?.serviceEndpoint?.playlistEditEndpoint?.customAction?.parameters;

        return {
            patched,
            acyclic,
            addToQueue: !!queued && !!queued.tileRenderer?.contentId,
            hqThumbnail: /sddefault\.jpg/.test(decorated.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.[0]?.url || ''),
            evalMs,
            native: time(() => nativeParse(text), 30),
            hooked: time(() => JSON.parse(text), 30),
            boringNative: time(() => nativeParse(boring), 20000),
            boringHooked: time(() => JSON.parse(boring), 20000)
        };
    }, { port, fixture: FIXTURE(SHELVES, TILES), load: loadScript.toString() });

    const domHooked = await churn();

    let profile = null;
    if (flag('--profile')) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 20 });
        await cdp.send('Profiler.start');
        await page.evaluate(() => { for (let i = 0; i < 200; i++) JSON.parse(window.__benchText || '{}'); });
        await page.evaluate((t) => { window.__benchText = t; }, '{}');
        profile = (await cdp.send('Profiler.stop')).profile;
    }

    await browser.close();
    server.close();

    const tiles = SHELVES * TILES;
    const pct = (a, b) => `${b >= a ? '+' : ''}${(((b - a) / a) * 100).toFixed(0)}%`;

    ui.heading('bench');
    console.log(`  bundle   ${BUNDLE.replace(ROOT, '.')}`);
    console.log(`  fixture  ${tiles} tiles in ${SHELVES} shelves\n`);

    const bad = [];
    if (!json.patched) bad.push('the bundle never installed its JSON hooks');
    if (!json.acyclic) bad.push('the decorated response is circular');
    if (!json.addToQueue) bad.push('the Add to Queue payload is missing or malformed');
    if (!json.hqThumbnail) bad.push('the HQ thumbnail rewrite did not apply');

    if (bad.length) {
        bad.forEach((line) => console.log(`  !! ${line}`));
        console.log('  numbers below are not meaningful\n');
    }

    console.log(`  script parse + execute        ${json.evalMs.toFixed(1)} ms`);
    console.log('');
    console.log('  json                        native      hooked    overhead');
    console.log(`    ordinary response      ${json.boringNative.toFixed(4)}ms  ${json.boringHooked.toFixed(4)}ms    ${pct(json.boringNative, json.boringHooked)}`);
    console.log(`    browse response          ${json.native.toFixed(2)}ms      ${json.hooked.toFixed(2)}ms    ${pct(json.native, json.hooked)}`);
    console.log(`    per tile                                       ${((json.hooked - json.native) / tiles * 1000).toFixed(1)} us`);
    console.log('');
    console.log('  dom                           bare      hooked    overhead');
    console.log(`    ${domBare.mutations} mutations         ${domBare.elapsed.toFixed(0)}ms        ${domHooked.elapsed.toFixed(0)}ms    ${pct(domBare.elapsed, domHooked.elapsed)}`);

    if (profile) {
        const byId = new Map(profile.nodes.map((n) => [n.id, n]));
        const self = new Map();
        profile.samples.forEach((id) => {
            const node = byId.get(id);
            if (!node) return;
            const name = node.callFrame.functionName || '(anonymous)';
            self.set(name, (self.get(name) || 0) + 1);
        });
        const total = profile.samples.length || 1;
        console.log('\n  profile (self time, minified names unless built without terser)');
        [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
            .forEach(([name, n]) => console.log(`    ${((n / total) * 100).toFixed(1).padStart(5)}%  ${name}`));
    }

    if (errors.length) {
        console.log(`\n  page errors (${errors.length}):`);
        [...new Set(errors)].slice(0, 5).forEach((e) => console.log(`    ${e}`));
    }

    console.log('');
    if (bad.length) process.exit(1);
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
