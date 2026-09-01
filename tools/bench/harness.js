'use strict';

// Shared rig for `tools/bench.js` and `tools/profile.js`: a headless Chromium with a
// page shaped enough like YouTube's TV client that the userscript installs into it and
// its handlers have something real to walk.
//
// Needs Chromium and playwright-core. Neither is a dependency of this repo, because
// neither is needed to build or ship it:
//
//     npm i --no-save playwright-core

const http = require('http');
const { readFileSync, existsSync } = require('fs');

function chromium() {
    let playwright;
    try {
        playwright = require('playwright-core');
    } catch (e) {
        console.error('playwright-core is not installed.\n  npm i --no-save playwright-core');
        process.exit(1);
    }

    // Where the Claude Code on the web image keeps it; otherwise let playwright look.
    const bundled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
    const executablePath = process.env.CHROME_PATH || (existsSync(bundled) ? bundled : undefined);

    return { playwright, executablePath };
}

const PAGE = `<!doctype html><html><head><style nonce="x"></style></head><body>
<video></video>
<ytlr-search-bar></ytlr-search-bar>
<ytlr-redux-connect-ytlr-progress-bar>
  <ytlr-progress-bar hybridnavfocusable="true"></ytlr-progress-bar>
  <div idomkey="slider"></div>
</ytlr-redux-connect-ytlr-progress-bar>
<div idomkey="Metadata-Section"></div>
<div id="stage"></div>
</body></html>`;

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

// YouTube's module registry, at a realistic size. This matters more than it looks:
// `json.js` re-walks every key of it every 250ms for the first 15 seconds, hunting for
// modules that captured their own JSON reference, so a registry of five understates
// startup by two orders of magnitude. The real client carries several hundred.
const STUBS = (modules) => {
    const icons = new Map([['CLEAR_COOKIES', 'a'], ['MICROPHONE_ON', 'b']]);
    const services = new Map([
        ['PlayerService', { loadedPlaybackConfig: { watchEndpoint: {} }, loadVideo() {} }],
        ['PlaybackPreviewService', { start() {}, stop() {} }]
    ]);
    services.mappings = true;

    const registry = { icons, services };
    for (let i = 0; i < modules; i++) {
        // A slice of them carry their own JSON reference, as the real bundle's do.
        registry[`m${i}`] = i % 7 === 0
            ? { JSON: { parse: JSON.parse, stringify: JSON.stringify }, n: i }
            : { n: i, f() { return i; } };
    }

    window._yttv = registry;
    window.tectonicConfig = { featureSwitches: {}, clientData: {} };
    window.queuedVideos = { videos: [], lastVideoId: null };
};

// A structurally realistic browse response. The handlers walk this shape, so the cost is
// proportional to it; a flat fixture would measure nothing.
function fixture(shelves, tiles) {
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
}

// Evaluated in the page: appends the bundle as a script tag and resolves when it runs.
function loadScript(port) {
    return new Promise((resolve, reject) => {
        const element = document.createElement('script');
        element.src = `http://127.0.0.1:${port}/userScript.js`;
        element.onload = resolve;
        element.onerror = reject;
        document.head.appendChild(element);
    });
}

/** A page with the stubs in place and the bundle served, but not yet loaded. */
async function open(bundlePath, { modules = 400 } = {}) {
    if (!existsSync(bundlePath)) {
        console.error(`No bundle at ${bundlePath} — run \`npm run build\` first.`);
        process.exit(1);
    }

    const { playwright, executablePath } = chromium();
    const server = await serve(readFileSync(bundlePath, 'utf8'));
    const port = server.address().port;

    const browser = await playwright.chromium.launch({
        executablePath,
        args: [
            '--no-sandbox',
            '--autoplay-policy=no-user-gesture-required',
            // Nothing here should be reaching the network; it only adds noise and
            // occasionally stalls a launch behind a proxy.
            '--disable-background-networking',
            '--disable-component-update',
            '--disable-sync',
            '--no-first-run'
        ]
    });

    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(STUBS, modules);

    return {
        page,
        port,
        errors,
        load: () => page.evaluate(
            ({ port, source }) => new Function('port', `return (${source})(port)`)(port),
            { port, source: loadScript.toString() }
        ),
        close: async () => { await browser.close(); server.close(); }
    };
}

/**
 * Samples the main thread while `body` runs, and returns self time by function.
 *
 * `interval` is in microseconds and has to be scaled to the window: the profile comes
 * back as one array entry per sample, so sampling several seconds at 20us means several
 * hundred thousand of them to serialise over CDP and parse here, which takes far longer
 * than the thing being measured. Roughly ten thousand samples is plenty for attribution.
 */
async function profile(page, body, { interval = 20 } = {}) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval });
    await cdp.send('Profiler.start');

    await body();

    const { profile: cpu } = await cdp.send('Profiler.stop');

    const byId = new Map(cpu.nodes.map((n) => [n.id, n]));
    const self = new Map();
    let ours = 0;
    let idle = 0;

    cpu.samples.forEach((id) => {
        const node = byId.get(id);
        if (!node) return;

        const frame = node.callFrame;
        const name = frame.functionName || '(anonymous)';
        const mine = (frame.url || '').indexOf('userScript') !== -1;

        if (name === '(idle)' || name === '(program)') idle++;
        if (mine) ours++;

        const key = mine ? name : `${name}  [${name === '(idle)' || name === '(program)' || name === '(garbage collector)' ? 'vm' : 'page'}]`;
        self.set(key, (self.get(key) || 0) + 1);
    });

    const total = cpu.samples.length || 1;
    const wall = (cpu.endTime - cpu.startTime) / 1000;   // ms

    return {
        rows: [...self.entries()].sort((a, b) => b[1] - a[1]),
        total,
        idle,
        ours,
        wall,
        // Sampling is uniform, so a share of samples is a share of the sampled window.
        oursMs: (ours / total) * wall
    };
}

module.exports = { open, profile, fixture, serve, chromium, STUBS };
