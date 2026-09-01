'use strict';

// A debugger for the app while it is running on a television, in one command.
//
//   npm run tv                      what the set is playing right now
//   npm run tv -- --frames          frame-drop measurement at the 2160p60 baseline
//   npm run tv -- --eval "1 + 1"    run something in the YouTube page
//   npm run tv -- --repl            a console on the television
//
// Everything is found rather than configured. The set is located by its Samsung API,
// the debugger by the port the app's own injector opened, and both are remembered in
// .dev/tv.json so the next run starts instantly. Nothing here needs sdb: the app has
// already put itself under the DevTools Protocol, and this attaches alongside it —
// running `debug` again would only relaunch the app out from under itself.
//
// If no debugger is found the app is not on the CDP path; see --help.

const { createInterface } = require('readline');
const { mkdirSync, readFileSync, writeFileSync } = require('fs');
const { networkInterfaces } = require('os');
const http = require('http');
const net = require('net');
const { dirname, join } = require('path');

const CDP = require('chrome-remote-interface');

const CACHE = join(__dirname, '..', '.dev', 'tv.json');

// The baseline, fixed so two runs are comparable.
const VIDEO = 'LXb3EKWsInQ';
const QUALITY = 'hd2160';

// Chrome takes an ephemeral port for the debugger, so it is searched for, not guessed.
const EPHEMERAL = [32768, 61000];
const SAMSUNG_API_PORT = 8001;

// Both `--key=value` and `--key value`, because one of them is always the one you typed.
const VALUELESS = ['repl', 'help', 'as-is', 'why', 'census'];

const args = (() => {
    const parsed = { _: [] };
    const argv = process.argv.slice(2);

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.indexOf('--') !== 0) { parsed._.push(arg); continue; }

        const equals = arg.indexOf('=');
        if (equals !== -1) {
            parsed[arg.slice(2, equals)] = arg.slice(equals + 1);
            continue;
        }

        const key = arg.slice(2);
        const next = argv[i + 1];
        if (!VALUELESS.includes(key) && next !== undefined && next.indexOf('--') !== 0) {
            parsed[key] = next;
            i++;
        } else {
            parsed[key] = true;
        }
    }

    return parsed;
})();

// --quality=hd1080 and the like, for comparing one rung against another.
const PINNED = args.quality || QUALITY;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (message) => console.error(`  ${message}`);

/* -- finding things ------------------------------------------------------- */

function readCache() {
    try { return JSON.parse(readFileSync(CACHE, 'utf8')); } catch (e) { return {}; }
}

function writeCache(value) {
    try {
        mkdirSync(dirname(CACHE), { recursive: true });
        writeFileSync(CACHE, JSON.stringify(value, null, 2));
    } catch (e) { /* a cache that cannot be written is only slower */ }
}

function tcpOpen(host, port, timeout) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const done = (ok) => { socket.destroy(); resolve(ok); };
        socket.setTimeout(timeout);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
        socket.connect(port, host);
    });
}

function getJson(host, port, path, timeout) {
    return new Promise((resolve) => {
        const request = http.get({ host, port, path, timeout }, (response) => {
            let body = '';
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
            });
        });
        request.on('timeout', () => request.destroy());
        request.on('error', () => resolve(null));
    });
}

/** Runs `task` over `items`, `width` at a time. */
async function pooled(items, width, task) {
    const results = [];
    let index = 0;
    await Promise.all(Array.from({ length: width }, async () => {
        for (;;) {
            const i = index++;
            if (i >= items.length) return;
            const value = await task(items[i]);
            if (value !== undefined && value !== null) results.push(value);
        }
    }));
    return results;
}

/** Every /24 this machine sits on, so the set is found without being told. */
function localSubnets() {
    const found = [];
    const interfaces = networkInterfaces();
    Object.keys(interfaces).forEach((name) => {
        (interfaces[name] || []).forEach((entry) => {
            if (entry.family !== 'IPv4' || entry.internal) return;
            found.push(entry.address.split('.').slice(0, 3).join('.'));
        });
    });
    return [...new Set(found)];
}

async function isTheTelevision(ip) {
    const info = await getJson(ip, SAMSUNG_API_PORT, '/api/v2/', 2500);
    const device = info && info.device;
    if (!device || device.OS !== 'Tizen') return null;
    return { ip, name: String(device.name || '').replace(/&quot;/g, '"'), model: device.modelName };
}

async function findTelevision() {
    if (args.tv && args.tv !== true) {
        const known = await isTheTelevision(args.tv);
        if (known) return known;
        throw new Error(`${args.tv} did not answer as a Tizen television on :${SAMSUNG_API_PORT}.`);
    }

    const cached = readCache();
    if (cached.ip) {
        const known = await isTheTelevision(cached.ip);
        if (known) return known;
    }

    say('looking for a television ...');
    for (const subnet of localSubnets()) {
        const hosts = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
        const found = await pooled(hosts, 64, async (ip) =>
            (await tcpOpen(ip, SAMSUNG_API_PORT, 400)) ? isTheTelevision(ip) : null);
        if (found.length) return found[0];
    }

    throw new Error('No Tizen television answered on this network. Is it on? Pass --tv=<ip> to skip the search.');
}

/** The page the app is really running in, whatever port the injector happened to get. */
async function findDebugger(ip) {
    const check = async (port) => {
        const version = await getJson(ip, port, '/json/version', 1200);
        if (!version || !/SMART-TV|Tizen/i.test(version['User-Agent'] || '')) return null;
        return port;
    };

    const cached = readCache();
    if (cached.ip === ip && cached.port && await check(cached.port)) return cached.port;

    say('looking for the debugger ...');
    const ports = [];
    for (let port = EPHEMERAL[0]; port <= EPHEMERAL[1]; port++) ports.push(port);

    const open = await pooled(ports, 800, async (port) =>
        (await tcpOpen(ip, port, 400)) ? port : null);

    for (const port of open.sort((a, b) => a - b)) {
        if (await check(port)) return port;
    }

    throw new Error(
        'The app is not under the DevTools Protocol.\n' +
        '  It only is when Developer Mode is on and the set can reach its own sdb daemon;\n' +
        '  otherwise the app runs on its proxy fallback and there is nothing to attach to.\n' +
        '  Open the app on the TV and try again, or check `npm run tv -- --why`.'
    );
}

/* -- talking to the page -------------------------------------------------- */

async function attach() {
    const tv = await findTelevision();
    say(`${tv.name || 'television'} (${tv.model || '?'}) at ${tv.ip}`);

    const port = await findDebugger(tv.ip);
    writeCache({ ip: tv.ip, port });

    const targets = await CDP.List({ host: tv.ip, port });
    const page = targets.find((t) => t.type === 'page' && /youtube/i.test(t.url || ''))
        || targets.find((t) => t.type === 'page');

    if (!page) throw new Error(`The debugger on :${port} has no page open.`);

    say(`attached on :${port} — ${decodeURIComponent(page.url).slice(0, 90)}`);

    const client = await CDP({ target: page.webSocketDebuggerUrl });
    await client.Runtime.enable();
    return { client, tv, port };
}

async function evaluate(client, expression) {
    const { result, exceptionDetails } = await client.Runtime.evaluate({
        expression, returnByValue: true, awaitPromise: true
    });
    if (exceptionDetails) {
        const thrown = exceptionDetails.exception || {};
        throw new Error(thrown.description || thrown.value || exceptionDetails.text);
    }
    return result.value;
}

// Everything worth knowing about what is on screen, in one read.
const STATE = `
(function () {
    var v = document.querySelector('video');
    var p = document.querySelector('#movie_player, .html5-video-player');
    var out = { url: location.href, hasVideo: !!v, hasPlayer: !!p };
    if (v) {
        out.size = v.videoWidth + 'x' + v.videoHeight;
        out.paused = v.paused;
        out.time = Math.round(v.currentTime) + '/' + Math.round(v.duration || 0) + 's';
        out.buffered = v.buffered.length ? +(v.buffered.end(v.buffered.length - 1) - v.currentTime).toFixed(1) : 0;
        if (v.getVideoPlaybackQuality) {
            var q = v.getVideoPlaybackQuality();
            out.decoded = q.totalVideoFrames;
            out.dropped = q.droppedVideoFrames;
        }
    }
    if (p) {
        try { out.video = p.getVideoData().video_id; } catch (e) {}
        try { out.quality = p.getPlaybackQuality(); } catch (e) {}
        try { out.offered = (p.getAvailableQualityData() || []).map(function (e) { return e.qualityLabel; }); } catch (e) {}
        try {
            var s = p.getStatsForNerds();
            out.codecs = s.codecs; out.resolution = s.resolution; out.colour = s.color;
        } catch (e) {}
    }
    return out;
}())
`;

/**
 * Readings from the app's own diagnostics port, for when there is no debugger at all.
 * sdbd refuses most connections on this platform and sometimes wedges entirely, and
 * without it the app never gets a debug port — so this is the only way in. It is
 * read-only by construction: the app decides what to publish and nothing can be sent
 * back. Turn it on in Settings on the television first.
 */
async function bridge(ip, seconds) {
    const port = 8097;
    const first = await getJson(ip, port, '/stats', 3000);

    if (!first) {
        console.log(`\n  Nothing is answering on ${ip}:${port}.`);
        console.log('  Turn on Settings → Playback → Diagnostics on the television, and make');
        console.log('  sure the app is on its proxy path — under CDP injection the page is');
        console.log('  youtube.com and cannot reach its own service.\n');
        return;
    }

    const show = (snapshot) => {
        const r = snapshot.reading || {};
        const age = snapshot.stale ? `  (STALE, ${snapshot.age}s old)` : '';
        console.log(`  ${String(r.mediaTime).padStart(7)}s  ${(r.quality || '?').padEnd(8)} ` +
            `${(r.resolution || '?').padEnd(26)} buf ${String(r.buffer || '?').padEnd(8)} ` +
            `frames ${r.frames || '?'}${r.derived ? ' [derived]' : ''}${age}`);
    };

    if (!seconds) {
        const r = first.reading || {};
        console.log('');
        Object.keys(r).forEach((key) => console.log(`  ${key.padEnd(12)} ${r[key]}`));
        console.log(`  ${'age'.padEnd(12)} ${first.age}s${first.stale ? ' (stale)' : ''}\n`);
        return;
    }

    console.log(`\n  watching ${ip}:${port} for ${seconds}s\n`);
    for (let i = 0; i < seconds; i++) {
        const snapshot = await getJson(ip, port, '/stats', 3000);
        if (snapshot) show(snapshot);
        await sleep(1000);
    }
    console.log('');
}

/* -- what it does --------------------------------------------------------- */

/**
 * Reads or flips where the media comes from.
 *
 * Which of the app's two paths is in use decides whether this means anything. Under CDP
 * injection the page is youtube.com itself and the media never touches this service, so
 * there is nothing to switch. On the proxy fallback the page is served from the service
 * and every video byte is piped through it — that is the case worth testing, and the
 * only one where the switch does anything.
 */
async function mediaMode(client, wanted) {
    const origin = await evaluate(client, 'location.origin');

    if (!/^http:\/\/localhost:8099/.test(origin)) {
        console.log(`\n  The page is ${origin}, so the app is on the CDP injection path.`);
        console.log('  Media already comes straight from googlevideo here — this service is not in');
        console.log('  the video path at all, and there is nothing to switch.\n');
        return;
    }

    const result = await evaluate(client, `
        fetch('/__tube/media${wanted && wanted !== true ? `?mode=${wanted}` : ''}')
            .then(function (r) { return r.json(); })
            .catch(function (e) { return { error: String(e && e.message || e) }; })
    `);

    if (result && result.error) {
        console.log(`\n  Could not reach the service: ${result.error}\n`);
        return;
    }

    console.log(`\n  media: ${result.mode}${result.proxied
        ? '  (every byte through this service)'
        : '  (straight from googlevideo)'}\n`);
}

/** Puts the set on a known video, so two measurements are of the same thing. */
async function play(client, videoId) {
    const current = await evaluate(client, `
        (function () {
            var p = document.querySelector('#movie_player, .html5-video-player');
            return p && p.getVideoData ? p.getVideoData().video_id : null;
        }())
    `);

    if (current !== videoId) {
        // The shell ignores a #/watch hash once it is already on a watch route, so the
        // player is asked directly — which works from any screen the app is on.
        say(`loading ${videoId} ...`);
        await evaluate(client, `
            (function () {
                var p = document.querySelector('#movie_player, .html5-video-player');
                if (p && p.loadVideoById) p.loadVideoById('${videoId}');
                else location.hash = '#/watch?v=${videoId}';
                return true;
            }())
        `);

        for (let i = 0; i < 20; i++) {
            await sleep(1500);
            const now = await evaluate(client, `
                (function () {
                    var p = document.querySelector('#movie_player, .html5-video-player');
                    var v = document.querySelector('video');
                    return { id: p && p.getVideoData ? p.getVideoData().video_id : null, w: v ? v.videoWidth : 0 };
                }())
            `);
            if (now.id === videoId && now.w > 0) break;
        }
    }

    // Settle on the wanted rung before anything is measured.
    await evaluate(client, `
        (function () {
            var p = document.querySelector('#movie_player, .html5-video-player');
            try { p.setPlaybackQualityRange('${PINNED}', '${PINNED}'); } catch (e) {}
            return true;
        }())
    `);
    await sleep(8000);

    const state = await evaluate(client, STATE);
    say(`${state.video} at ${state.size}, ${state.codecs || '?'}`);
    return state;
}

async function showState(client) {
    const state = await evaluate(client, STATE);
    console.log('');
    Object.keys(state).forEach((key) => {
        const value = Array.isArray(state[key]) ? state[key].join(', ') : state[key];
        console.log(`  ${key.padEnd(12)} ${value}`);
    });
    console.log('');
}

// The sampler that runs on the television while nothing is attached to it. Polling this
// over CDP once a second roughly doubles the measured drop rate — the debugger competes
// for the same main thread — so the counting happens in the page and is collected after.
const SAMPLER_INSTALL = `
(function () {
    if (window.__tubeSamples) return 'already running';
    window.__tubeSamples = [];
    window.__tubeSampler = setInterval(function () {
        var v = document.querySelector('video');
        if (!v || !v.getVideoPlaybackQuality) return;
        var q = v.getVideoPlaybackQuality();
        window.__tubeSamples.push([q.totalVideoFrames, q.droppedVideoFrames, v.videoWidth, v.videoHeight, v.paused ? 1 : 0]);
    }, 1000);
    return 'running';
}())
`;

const SAMPLER_COLLECT = `
(function () {
    var samples = window.__tubeSamples || [];
    clearInterval(window.__tubeSampler);
    window.__tubeSamples = null;
    window.__tubeSampler = null;
    return samples;
}())
`;

/**
 * Frames lost over a window, counted by the page itself with nothing attached.
 * Totals accumulate from the gaps between samples: the counters restart with the video,
 * and a loop would otherwise read as a large negative count.
 */
function summarise(samples, state, seconds) {
    const playing = samples.filter((s) => s && !s[4]);
    if (playing.length < 2) {
        console.log('\n  Nothing played while this was watching.\n');
        return;
    }

    let decoded = 0;
    let dropped = 0;
    let resets = 0;
    const bursts = [];

    for (let i = 1; i < playing.length; i++) {
        const decodedDelta = playing[i][0] - playing[i - 1][0];
        const droppedDelta = playing[i][1] - playing[i - 1][1];
        if (decodedDelta < 0 || droppedDelta < 0) { resets++; continue; }
        decoded += decodedDelta;
        dropped += droppedDelta;
        if (droppedDelta > 0) bursts.push(`+${droppedDelta}`);
    }

    const elapsed = playing.length - 1 - resets;
    const last = playing[playing.length - 1];

    console.log('\n' + '='.repeat(60));
    console.log(`  video       ${state.video}`);
    console.log(`  resolution  ${last[2]}x${last[3]}  (${state.resolution || '?'})`);
    console.log(`  codecs      ${state.codecs || '?'}`);
    console.log(`  colour      ${state.colour || '?'}`);
    console.log(`  decoded     ${decoded} frames  (${(decoded / Math.max(1, elapsed)).toFixed(1)}/s over ${elapsed}s)`);
    console.log(`  dropped     ${dropped} frames  (${(100 * dropped / Math.max(1, decoded)).toFixed(2)}%)`);
    console.log(`  bursts      ${bursts.length} seconds lost frames: ${bursts.join(' ') || 'none'}`);
    if (resets) console.log(`  note        ${resets} counter reset${resets > 1 ? 's' : ''} skipped (the video restarted)`);
    console.log('='.repeat(60) + '\n');
}

/**
 * The stalls themselves. A frame is dropped when the main thread is busy past its
 * deadline, so this records every task over 50ms alongside the frames lost in the same
 * second — the two lists read together say whether script is what is costing frames.
 */
async function longTasks(client, seconds) {
    await evaluate(client, `
        (function () {
            if (window.__tubeStalls) return 'already watching';
            window.__tubeStalls = [];
            var v = document.querySelector('video');
            var base = v && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().droppedVideoFrames : 0;
            window.__tubeStallsBase = base;

            new PerformanceObserver(function (list) {
                list.getEntries().forEach(function (entry) {
                    var attribution = (entry.attribution || []).map(function (a) {
                        return a.name + (a.containerName ? '/' + a.containerName : '');
                    });
                    window.__tubeStalls.push({
                        at: Math.round(entry.startTime),
                        ms: Math.round(entry.duration),
                        name: entry.name,
                        from: attribution.join(',') || null,
                        dropped: v && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().droppedVideoFrames : null
                    });
                });
            }).observe({ entryTypes: ['longtask'] });

            return 'watching';
        }())
    `);

    say(`watching for stalls over ${seconds}s ...`);
    const before = await evaluate(client, STATE);
    await sleep(seconds * 1000);
    const after = await evaluate(client, STATE);

    const stalls = await evaluate(client, 'window.__tubeStalls.slice()');
    await evaluate(client, '(function () { window.__tubeStalls = []; return true; }())');

    const droppedTotal = after.dropped - before.dropped;
    const buckets = { '50-100': 0, '100-200': 0, '200-500': 0, '500+': 0 };
    let stallTime = 0;

    stalls.forEach((stall) => {
        stallTime += stall.ms;
        if (stall.ms < 100) buckets['50-100']++;
        else if (stall.ms < 200) buckets['100-200']++;
        else if (stall.ms < 500) buckets['200-500']++;
        else buckets['500+']++;
    });

    console.log('\n' + '='.repeat(66));
    console.log(`  stalls over ${seconds}s at ${after.size}`);
    console.log('='.repeat(66));
    console.log(`  dropped     ${droppedTotal} frames`);
    console.log(`  long tasks  ${stalls.length}, ${stallTime}ms total (${(100 * stallTime / (seconds * 1000)).toFixed(1)}% of wall)`);
    console.log(`  spread      50-100ms: ${buckets['50-100']}   100-200ms: ${buckets['100-200']}   200-500ms: ${buckets['200-500']}   500ms+: ${buckets['500+']}`);

    const worst = stalls.slice().sort((a, b) => b.ms - a.ms).slice(0, 12);
    if (worst.length) {
        console.log('\n  worst stalls');
        console.log('  ' + '-'.repeat(62));
        worst.forEach((stall) => {
            console.log(`  ${String(stall.ms + 'ms').padStart(7)}  ${stall.name.padEnd(18)} ${stall.from || ''}`);
        });
    }
    console.log('='.repeat(66) + '\n');
}

/**
 * Whose code is costing the frames. Samples the profiler and attributes self time to the
 * script each frame came from, so the userscript's share can be read against YouTube's
 * own player rather than guessed at. The userscript is evaluated, not fetched, so it has
 * no URL — it is identified by a string only our bundle contains.
 */
async function blame(client, seconds) {
    const MARKER = 'tube.settings';

    const scripts = new Map();
    client.on('Debugger.scriptParsed', (event) => {
        scripts.set(event.scriptId, { url: event.url || '', length: event.length || 0 });
    });

    await client.Debugger.enable();
    // Scripts parsed before we attached are reported on enable; give them a moment.
    await sleep(1500);

    // Anything without a URL was evaluated in. Ours is the one carrying the marker.
    const ours = new Set();
    for (const [scriptId, meta] of scripts) {
        if (meta.url) continue;
        if (meta.length < 1000) continue;
        try {
            const { scriptSource } = await client.Debugger.getScriptSource({ scriptId });
            if (scriptSource.indexOf(MARKER) !== -1) ours.add(scriptId);
        } catch (e) { /* gone already */ }
    }
    await client.Debugger.disable();

    say(`${scripts.size} scripts, ${ours.size} of them ours`);

    await client.Profiler.enable();
    await client.Profiler.setSamplingInterval({ interval: 500 });

    const before = await evaluate(client, STATE);
    say(`profiling for ${seconds}s ...`);
    await client.Profiler.start();
    await sleep(seconds * 1000);
    const { profile: cpu } = await client.Profiler.stop();
    const after = await evaluate(client, STATE);
    await client.Profiler.disable();

    const byId = new Map(cpu.nodes.map((node) => [node.id, node]));
    const perNode = new Map();
    (cpu.samples || []).forEach((id, index) => {
        perNode.set(id, (perNode.get(id) || 0) + (cpu.timeDeltas[index] || 0));
    });

    /** Which bucket a stack frame belongs to. */
    const bucketOf = (frame) => {
        const name = frame.functionName || '';
        if (name === '(idle)') return 'idle';
        if (name === '(program)') return 'browser internals';
        if (name === '(garbage collector)') return 'garbage collector';
        if (ours.has(frame.scriptId)) return 'OUR USERSCRIPT';
        const url = frame.url || '';
        if (!url) return 'other evaluated script';
        if (/tv-player/.test(url)) return 'youtube player';
        if (/\/s\/tv\/|base|desktop_polymer/.test(url)) return 'youtube app';
        return url.replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(-40);
    };

    const buckets = new Map();
    const ourFunctions = new Map();

    for (const [id, micros] of perNode) {
        const node = byId.get(id);
        if (!node) continue;
        const frame = node.callFrame || {};
        const bucket = bucketOf(frame);
        buckets.set(bucket, (buckets.get(bucket) || 0) + micros / 1000);
        if (ours.has(frame.scriptId)) {
            const key = `${frame.functionName || '(anonymous)'}:${frame.lineNumber + 1}`;
            ourFunctions.set(key, (ourFunctions.get(key) || 0) + micros / 1000);
        }
    }

    const wall = seconds * 1000;
    const rows = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    const ourTotal = buckets.get('OUR USERSCRIPT') || 0;

    console.log('\n' + '='.repeat(66));
    console.log(`  main thread over ${seconds}s at ${after.size}`);
    console.log('='.repeat(66));
    console.log(`  frames      decoded ${after.decoded - before.decoded}, dropped ${after.dropped - before.dropped}`);
    console.log(`  codecs      ${after.codecs || '?'}\n`);

    rows.forEach(([name, ms]) => {
        if (name === 'idle') return;
        console.log(`  ${(100 * ms / wall).toFixed(1).padStart(5)}%  ${String(Math.round(ms) + 'ms').padStart(7)}  ${name}`);
    });

    console.log(`\n  our userscript: ${ourTotal.toFixed(0)}ms of ${wall}ms (${(100 * ourTotal / wall).toFixed(2)}%)`);
    if (ourFunctions.size) {
        console.log('  ' + '-'.repeat(62));
        [...ourFunctions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([name, ms]) => {
            console.log(`  ${String(Math.round(ms) + 'ms').padStart(7)}  ${name}`);
        });
    } else {
        console.log('  nothing from our bundle appeared in any sample.');
    }
    console.log('='.repeat(66) + '\n');
}

/**
 * The cost our code *causes*, not just the cost inside it. Self time misses work we
 * provoke elsewhere — a patched JSON.parse whose readers walk a large response bills the
 * walking to us, but the re-serialising and the collection it feeds land under the
 * player and the GC. So this attributes whole subtrees: any stack passing through our
 * script counts, and allocations are sampled alongside, because collection time is
 * bought with allocation.
 */
async function deep(client, seconds) {
    const MARKER = 'tube.settings';

    const scripts = new Map();
    client.on('Debugger.scriptParsed', (event) => {
        scripts.set(event.scriptId, { url: event.url || '', length: event.length || 0 });
    });
    await client.Debugger.enable();
    await sleep(1500);

    const ours = new Set();
    for (const [scriptId, meta] of scripts) {
        if (meta.url || meta.length < 1000) continue;
        try {
            const { scriptSource } = await client.Debugger.getScriptSource({ scriptId });
            if (scriptSource.indexOf(MARKER) !== -1) ours.add(scriptId);
        } catch (e) { /* gone */ }
    }
    await client.Debugger.disable();
    say(`${ours.size} script(s) of ours among ${scripts.size}`);

    await client.HeapProfiler.enable();
    await client.Profiler.enable();
    // Gentler than the default: sampling hard on a TV distorts what it measures.
    await client.Profiler.setSamplingInterval({ interval: 2000 });

    const before = await evaluate(client, STATE);
    await client.HeapProfiler.startSampling({ samplingInterval: 65536 });
    await client.Profiler.start();
    say(`measuring ${seconds}s ...`);
    await sleep(seconds * 1000);
    const { profile: cpu } = await client.Profiler.stop();
    const { profile: heap } = await client.HeapProfiler.stopSampling();
    const after = await evaluate(client, STATE);
    await client.Profiler.disable();
    await client.HeapProfiler.disable();

    /* --- inclusive CPU time through our frames --- */

    const nodes = new Map(cpu.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    cpu.nodes.forEach((n) => (n.children || []).forEach((child) => parent.set(child, n.id)));

    const self = new Map();
    (cpu.samples || []).forEach((id, i) => self.set(id, (self.get(id) || 0) + (cpu.timeDeltas[i] || 0)));

    // Inclusive = self + children, computed leaves-first.
    const inclusive = new Map();
    const order = [];
    const walk = (id) => {
        order.push(id);
        (nodes.get(id).children || []).forEach(walk);
    };
    cpu.nodes.filter((n) => !parent.has(n.id)).forEach((n) => walk(n.id));
    for (let i = order.length - 1; i >= 0; i--) {
        const id = order[i];
        let total = self.get(id) || 0;
        (nodes.get(id).children || []).forEach((child) => { total += inclusive.get(child) || 0; });
        inclusive.set(id, total);
    }

    const isOurs = (id) => ours.has((nodes.get(id).callFrame || {}).scriptId);
    const hasOurAncestor = (id) => {
        let cursor = parent.get(id);
        while (cursor !== undefined) {
            if (isOurs(cursor)) return true;
            cursor = parent.get(cursor);
        }
        return false;
    };

    let ourInclusive = 0;
    let ourSelf = 0;
    const entryPoints = new Map();
    cpu.nodes.forEach((n) => {
        if (!isOurs(n.id)) return;
        ourSelf += self.get(n.id) || 0;
        if (hasOurAncestor(n.id)) return;
        const micros = inclusive.get(n.id) || 0;
        ourInclusive += micros;
        const frame = n.callFrame || {};
        const key = `${frame.functionName || '(anonymous)'}:${frame.lineNumber + 1}`;
        entryPoints.set(key, (entryPoints.get(key) || 0) + micros);
    });

    /* --- allocation, by whether our frames are on the stack --- */

    let ourBytes = 0;
    let totalBytes = 0;
    const allocators = new Map();
    const walkHeap = (node, underOurs) => {
        const frame = node.callFrame || {};
        const mine = underOurs || ours.has(frame.scriptId);
        const size = (node.selfSize || 0);
        totalBytes += size;
        if (mine) ourBytes += size;
        if (size > 0) {
            const where = (frame.url || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0];
            const key = `${frame.functionName || '(anonymous)'} ${where ? where.slice(-28) : (ours.has(frame.scriptId) ? '[ours]' : '[native]')}`;
            allocators.set(key, (allocators.get(key) || 0) + size);
        }
        (node.children || []).forEach((child) => walkHeap(child, mine));
    };
    if (heap && heap.head) walkHeap(heap.head, false);

    const wall = seconds * 1000;
    const pct = (ms) => (100 * ms / wall).toFixed(2);

    console.log('\n' + '='.repeat(68));
    console.log(`  ${seconds}s at ${after.size} — ${after.codecs || '?'}`);
    console.log('='.repeat(68));
    console.log(`  frames        decoded ${after.decoded - before.decoded}, dropped ${after.dropped - before.dropped}`);
    console.log('');
    console.log(`  our code, self time        ${(ourSelf / 1000).toFixed(0)}ms   ${pct(ourSelf / 1000)}% of wall`);
    console.log(`  our code, inclusive time   ${(ourInclusive / 1000).toFixed(0)}ms   ${pct(ourInclusive / 1000)}% of wall`);
    console.log(`     (everything on a stack that passes through our script)`);

    if (entryPoints.size) {
        console.log('\n  where our code is entered from');
        console.log('  ' + '-'.repeat(64));
        [...entryPoints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([name, micros]) => {
            console.log(`  ${String(Math.round(micros / 1000) + 'ms').padStart(7)}  ${name}`);
        });
    }

    console.log(`\n  allocated total            ${(totalBytes / 1048576).toFixed(1)} MB over ${seconds}s`);
    console.log(`  allocated under our code   ${(ourBytes / 1048576).toFixed(2)} MB   ${(100 * ourBytes / Math.max(1, totalBytes)).toFixed(2)}%`);
    console.log('\n  biggest allocators');
    console.log('  ' + '-'.repeat(64));
    [...allocators.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([name, size]) => {
        console.log(`  ${String((size / 1024).toFixed(0) + ' KB').padStart(9)}  ${name.slice(0, 56)}`);
    });
    console.log('='.repeat(68) + '\n');
}

/**
 * Why each frame was lost, from the compositor rather than from JavaScript. Chrome runs
 * every frame through a pipeline — generation, main-thread work, commit, activation,
 * rasterisation, then presentation on the GPU — and emits a PipelineReporter for each
 * one saying whether it arrived and, if not, which stage ran out of time. That is the
 * measurement that separates "our script held the thread" from "the decoder or the
 * display could not keep up", which no JS profile can tell apart.
 */
async function trace(client, seconds) {
    const events = [];
    client.on('Tracing.dataCollected', ({ value }) => { events.push(...value); });

    const done = new Promise((resolve) => client.once('Tracing.tracingComplete', resolve));

    const before = await evaluate(client, STATE);
    say(`tracing ${seconds}s ...`);

    await client.Tracing.start({
        transferMode: 'ReportEvents',
        traceConfig: {
            recordMode: 'recordAsMuchAsPossible',
            includedCategories: [
                'disabled-by-default-devtools.timeline.frame',
                'disabled-by-default-devtools.timeline',
                'benchmark',
                'viz',
                'gpu',
                'media'
            ]
        }
    });

    await sleep(seconds * 1000);
    await client.Tracing.end();
    await done;

    const after = await evaluate(client, STATE);
    say(`${events.length} trace events`);

    // PipelineReporter carries the verdict for one frame; its sub-slices name the stage.
    const states = new Map();
    const stageTime = new Map();
    const reasons = new Map();
    let reporters = 0;

    events.forEach((event) => {
        const args = event.args || {};
        const data = args.data || {};

        if (event.name === 'PipelineReporter') {
            reporters++;
            const state = data.state || args.state || 'unknown';
            states.set(state, (states.get(state) || 0) + 1);
            const reason = data.termination_status || data.breakdown || args.termination_status;
            if (reason) reasons.set(String(reason), (reasons.get(String(reason)) || 0) + 1);
            return;
        }

        // Stage slices sit under the reporter and carry their own durations.
        if (event.ph === 'X' && event.dur && /^(SendBeginMainFrame|HandleInputEvents|Animate|StyleUpdate|LayoutUpdate|Prepaint|Paint|Commit|EndCommitToActivation|Activation|RasterTask|EndActivateToSubmitCompositorFrame|SubmitCompositorFrameToPresentationCompositorFrame|BeginImplFrameToSendBeginMainFrame)$/.test(event.name)) {
            stageTime.set(event.name, (stageTime.get(event.name) || 0) + event.dur / 1000);
        }

        if (event.name === 'DroppedFrame' || event.name === 'Graphics.Pipeline.DroppedFrame') {
            states.set('DroppedFrame', (states.get('DroppedFrame') || 0) + 1);
        }
    });

    console.log('\n' + '='.repeat(68));
    console.log(`  frame pipeline over ${seconds}s at ${after.size}`);
    console.log('='.repeat(68));
    console.log(`  video frames  decoded ${after.decoded - before.decoded}, dropped ${after.dropped - before.dropped}`);
    console.log(`  reporters     ${reporters}`);

    if (states.size) {
        console.log('\n  frame outcomes');
        console.log('  ' + '-'.repeat(64));
        [...states.entries()].sort((a, b) => b[1] - a[1]).forEach(([state, count]) => {
            console.log(`  ${String(count).padStart(7)}  ${state}`);
        });
    }

    if (reasons.size) {
        console.log('\n  termination');
        console.log('  ' + '-'.repeat(64));
        [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([reason, count]) => {
            console.log(`  ${String(count).padStart(7)}  ${reason}`);
        });
    }

    if (stageTime.size) {
        console.log('\n  time per pipeline stage (total ms across the window)');
        console.log('  ' + '-'.repeat(64));
        [...stageTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([stage, ms]) => {
            console.log(`  ${String(Math.round(ms) + 'ms').padStart(8)}  ${stage}`);
        });
    }

    // What the trace saw of the media pipeline, which is where a 4K60 decode would show.
    const media = new Map();
    events.forEach((event) => {
        if (!/^(WebMediaPlayer|Media|VideoFrame|kVideo|Decoder)/i.test(event.name || '')) return;
        media.set(event.name, (media.get(event.name) || 0) + 1);
    });
    if (media.size) {
        console.log('\n  media pipeline events');
        console.log('  ' + '-'.repeat(64));
        [...media.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([name, count]) => {
            console.log(`  ${String(count).padStart(7)}  ${name}`);
        });
    }
    console.log('='.repeat(68) + '\n');
}

/**
 * Which decoder is actually running. Chrome reports this per player: the decoder's name
 * and, decisively, whether it is a platform (hardware) decoder or a software fallback.
 * A software AV1 or VP9 decode at 2160p60 is the difference between a set that keeps up
 * and one that does not, and nothing else we can measure says it outright.
 */
async function media(client, seconds) {
    const players = new Map();

    client.on('Media.playersCreated', ({ players: ids }) => {
        ids.forEach((id) => { if (!players.has(id)) players.set(id, {}); });
    });

    client.on('Media.playerPropertiesChanged', ({ playerId, properties }) => {
        const bag = players.get(playerId) || {};
        (properties || []).forEach(({ name, value }) => { bag[name] = value; });
        players.set(playerId, bag);
    });

    client.on('Media.playerErrorsRaised', ({ playerId, errors }) => {
        const bag = players.get(playerId) || {};
        bag.__errors = (bag.__errors || []).concat((errors || []).map((e) => e.code || e.type || 'error'));
        players.set(playerId, bag);
    });

    await client.Media.enable();
    say(`listening to the media pipeline for ${seconds}s ...`);
    await sleep(seconds * 1000);
    await client.Media.disable();

    const state = await evaluate(client, STATE);

    console.log('\n' + '='.repeat(68));
    console.log(`  media pipeline — ${state.size}, ${state.codecs || '?'}`);
    console.log('='.repeat(68));

    if (!players.size) {
        console.log('  No player reported. Is anything playing?\n');
        return;
    }

    // The interesting keys first, then whatever else the build reports.
    const HEADLINE = [
        'kVideoDecoderName', 'kIsPlatformVideoDecoder', 'kIsVideoDecryptingDemuxerStream',
        'kAudioDecoderName', 'kIsPlatformAudioDecoder',
        'kVideoTracks', 'kFrameUrl', 'kRendererName', 'kIsRangeHeaderSupported'
    ];

    [...players.entries()].forEach(([id, bag], index) => {
        const keys = Object.keys(bag);
        if (!keys.length) return;
        console.log(`\n  player ${index + 1} (${id.slice(0, 12)})`);
        console.log('  ' + '-'.repeat(64));
        HEADLINE.forEach((key) => {
            if (bag[key] === undefined) return;
            console.log(`  ${key.padEnd(32)} ${String(bag[key]).slice(0, 60)}`);
        });
        keys.filter((k) => HEADLINE.indexOf(k) === -1 && k !== '__errors').sort().forEach((key) => {
            console.log(`  ${key.padEnd(32)} ${String(bag[key]).slice(0, 60)}`);
        });
        if (bag.__errors) console.log(`  ${'errors'.padEnd(32)} ${bag.__errors.join(', ')}`);
    });
    console.log('\n' + '='.repeat(68) + '\n');
}

/** What is installed on the page that could be costing frames. */
const CENSUS = `
(function () {
    var out = {};

    // Timers and animation callbacks the page has running, counted by patching the
    // registrars for a moment rather than guessing.
    out.rafPerSecond = null;

    var observers = { mutation: 0, resize: 0, intersection: 0, performance: 0 };
    ['MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver'].forEach(function (name) {
        var key = name.replace('Observer', '').toLowerCase();
        if (!window[name] || window[name].__counted) return;
        var Original = window[name];
        var Wrapped = function () {
            observers[key]++;
            return new Original(arguments[0], arguments[1]);
        };
        Wrapped.prototype = Original.prototype;
        Wrapped.__counted = true;
        window[name] = Wrapped;
    });

    out.observersCreatedFromNowOn = observers;
    out.elements = document.querySelectorAll('*').length;
    out.videoElements = document.querySelectorAll('video').length;
    out.iframes = document.querySelectorAll('iframe').length;
    out.animations = typeof document.getAnimations === 'function' ? document.getAnimations().length : null;
    out.memory = performance.memory ? {
        usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
        limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576)
    } : null;

    var longTasks = 0;
    try {
        new PerformanceObserver(function (list) { longTasks += list.getEntries().length; })
            .observe({ entryTypes: ['longtask'] });
        out.longTaskObserver = 'installed';
    } catch (e) { out.longTaskObserver = 'unsupported'; }

    return out;
}())
`;

async function census(client) {
    const before = await evaluate(client, CENSUS);
    console.log('');
    Object.keys(before).forEach((key) => {
        const value = before[key];
        console.log(`  ${key.padEnd(26)} ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    });

    // Frame cadence as the page itself sees it: if rAF cannot hold 60, script is late.
    const cadence = await evaluate(client, `
        new Promise(function (resolve) {
            var times = [];
            function step(t) { times.push(t); if (times.length < 120) requestAnimationFrame(step); else finish(); }
            function finish() {
                var deltas = [];
                for (var i = 1; i < times.length; i++) deltas.push(times[i] - times[i - 1]);
                deltas.sort(function (a, b) { return a - b; });
                resolve({
                    medianMs: +deltas[Math.floor(deltas.length / 2)].toFixed(2),
                    worstMs: +deltas[deltas.length - 1].toFixed(2),
                    over20ms: deltas.filter(function (d) { return d > 20; }).length,
                    frames: deltas.length
                });
            }
            requestAnimationFrame(step);
        })
    `);
    console.log(`  ${'rafCadence'.padEnd(26)} ${JSON.stringify(cadence)}`);
    console.log('');
}

function repl(client) {
    return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'tv> ' });
        console.log('\n  JavaScript runs in the YouTube page. ".exit" leaves.\n');
        rl.prompt();
        rl.on('line', async (line) => {
            const source = line.trim();
            if (source === '.exit' || source === '.quit') return rl.close();
            if (source) {
                try {
                    const value = await evaluate(client, `(${source})`);
                    console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
                } catch (error) {
                    console.log(`✗ ${error.message}`);
                }
            }
            rl.prompt();
        });
        rl.on('close', resolve);
    });
}

/* ------------------------------------------------------------------------- */

(async () => {
    if (args.help) {
        console.log(readFileSync(__filename, 'utf8').split('\n').slice(2, 18).join('\n').replace(/^\/\/ ?/gm, ''));
        return;
    }

    // The app's own readings, which need no debugger at all.
    if (args.bridge !== undefined) {
        const tv = await findTelevision();
        say(`${tv.name || 'television'} (${tv.model || '?'}) at ${tv.ip}`);
        await bridge(tv.ip, args.bridge === true ? 0 : Number(args.bridge));
        return;
    }

    // Frames are counted with nothing attached, so the run is split in two: arm the
    // sampler and disconnect, then come back for what it recorded.
    if (args.frames !== undefined) {
        const seconds = Number(args.frames === true ? 60 : args.frames);
        const armed = await attach();

        if (!args['as-is']) {
            await evaluate(armed.client, `
                (function () {
                    var p = document.querySelector('#movie_player, .html5-video-player');
                    try { p.setPlaybackQualityRange('${PINNED}', '${PINNED}'); } catch (e) {}
                    return true;
                }())
            `);
            say(`pinned ${PINNED}; letting it settle`);
            await sleep(8000);
        }

        await evaluate(armed.client, SAMPLER_INSTALL);
        await armed.client.close();
        say(`counting for ${seconds}s with nothing attached ...`);
        await sleep(seconds * 1000 + 1500);

        const back = await attach();
        try {
            const samples = await evaluate(back.client, SAMPLER_COLLECT);
            const state = await evaluate(back.client, STATE);
            summarise(samples, state, seconds);
        } finally {
            try { await back.client.close(); } catch (e) { /* already gone */ }
        }
        return;
    }

    const { client } = await attach();
    try {
        if (args.repl) await repl(client);
        else if (args.eval) console.log(JSON.stringify(await evaluate(client, `(${args.eval})`), null, 2));
        else if (args.census) await census(client);
        else if (args.media_mode !== undefined || args['media-mode'] !== undefined) {
            await mediaMode(client, args['media-mode'] !== undefined ? args['media-mode'] : args.media_mode);
        }
        else if (args.media !== undefined) await media(client, Number(args.media === true ? 12 : args.media));
        else if (args.trace !== undefined) {
            if (args.video !== undefined) await play(client, args.video === true ? VIDEO : args.video);
            await trace(client, Number(args.trace === true ? 10 : args.trace));
        }
        else if (args.deep !== undefined) {
            if (args.video !== undefined) await play(client, args.video === true ? VIDEO : args.video);
            await deep(client, Number(args.deep === true ? 30 : args.deep));
        }
        else if (args.blame !== undefined) {
            if (args.video !== undefined) await play(client, args.video === true ? VIDEO : args.video);
            await blame(client, Number(args.blame === true ? 30 : args.blame));
        }
        else if (args.play !== undefined) await play(client, args.play === true ? VIDEO : args.play);
        else if (args.stalls !== undefined) await longTasks(client, Number(args.stalls === true ? 30 : args.stalls));
        else await showState(client);
    } finally {
        try { await client.close(); } catch (e) { /* already gone */ }
    }
})().catch((error) => {
    console.error(`\n${error.message}\n`);
    process.exit(1);
});
