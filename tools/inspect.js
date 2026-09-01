'use strict';

// Inspects the app while it runs on a television. The set and its debug port are found
// rather than configured, and remembered in .dev/tv.json.
//
//   npm run inspect                    what it is playing
//   npm run inspect -- --frames 60     dropped frames, counted with nothing attached
//   npm run inspect -- --bridge        the same without a debugger, over the app's own port
//   npm run inspect -- --media         which decoder is running
//   npm run inspect -- --eval "1+1"    run something in the page
//   npm run inspect -- --repl          a console on the television

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
const VALUELESS = ['repl', 'help', 'as-is'];

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
        '  Open the app on the TV, or use `npm run inspect -- --bridge` instead.'
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

/** Readings from the app's own port, for when sdbd refuses and there is no debugger. */
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

/** Reads or flips where the media comes from. Only means anything on the proxy path. */
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
 * Frames lost over a window, counted by the page with nothing attached. Totals come from
 * the gaps between samples, since a loop restarts the counters.
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

/** Which decoder is running, and whether it is the platform one or a software fallback. */
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
        console.log(readFileSync(__filename, 'utf8').split('\n').slice(2, 11).join('\n').replace(/^\/\/ ?/gm, ''));
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
        else if (args.media_mode !== undefined || args['media-mode'] !== undefined) {
            await mediaMode(client, args['media-mode'] !== undefined ? args['media-mode'] : args.media_mode);
        }
        else if (args.media !== undefined) await media(client, Number(args.media === true ? 12 : args.media));
        else if (args.play !== undefined) await play(client, args.play === true ? VIDEO : args.play);
        else await showState(client);
    } finally {
        try { await client.close(); } catch (e) { /* already gone */ }
    }
})().catch((error) => {
    console.error(`\n${error.message}\n`);
    process.exit(1);
});
