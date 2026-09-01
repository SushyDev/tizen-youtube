'use strict';

// Three profiles, because the userscript costs something different in each phase.
//
//   startup     Injection to steady state. Parse and execute the bundle, then whatever
//               it schedules — the registry sweep, the polls waiting for YouTube to
//               exist. Paid once per launch, on the slowest CPU in the house.
//   navigation  A screen change: a browse response through the JSON hooks, then the
//               DOM being rebuilt under whatever is observing it.
//   playback    Steady state with a video running. Nothing here is about throughput;
//               it is about whether the main thread is free when the compositor wants
//               it, because a frame is only late if something was in the way.
//
//     node tools/profile.js                 # all three
//     node tools/profile.js playback        # one
//     node tools/profile.js --bundle <path> # compare against another build
//
// On the playback numbers: a Tizen set decodes 4K60 in fixed-function hardware, off the
// main thread, and that cannot be reproduced here — headless Chromium has no such
// decoder. What is reproduced is the part the userscript can actually affect: a real
// video element delivering frames at 60fps, a 4K canvas composited per frame to keep
// headroom tight, and YouTube's own progress-bar churn. What matters is our share of
// the 16.7ms frame budget and the length of the longest task, both of which transfer.
// A television's CPU is roughly an order of magnitude slower than this one.

const { join } = require('path');

const { ROOT } = require('./config.js');
const ui = require('./ui.js');
const harness = require('./bench/harness.js');

const args = process.argv.slice(2);

// Values belonging to a flag are consumed, so they are not mistaken for scenario names.
const consumed = new Set();
const value = (name, fallback) => {
    const at = args.indexOf(name);
    if (at === -1 || !args[at + 1]) return fallback;
    consumed.add(at);
    consumed.add(at + 1);
    return args[at + 1];
};

const BUNDLE = value('--bundle', join(ROOT, 'dist', 'userScript.modern.js'));
value('--seconds', null);
value('--frame-work', null);
value('--churn', null);

const WANTED = args.filter((a, i) => a.indexOf('--') !== 0 && !consumed.has(i));
const SCENARIOS = WANTED.length ? WANTED : ['startup', 'navigation', 'playback'];

const ms = (n) => `${n.toFixed(1)}ms`;
const pctOf = (n, total) => `${((n / total) * 100).toFixed(1)}%`;

function table(rows, total, wall, limit) {
    rows.slice(0, limit || 12).forEach(([name, count]) => {
        const share = ((count / total) * 100).toFixed(1).padStart(5);
        const time = ((count / total) * wall).toFixed(1).padStart(7);
        console.log(`      ${share}%  ${time}ms  ${name}`);
    });
}

/* --- startup ---------------------------------------------------------------------- */

async function startup() {
    const rig = await harness.open(BUNDLE);
    ui.group('startup');

    // Parse and execute, isolated from anything it schedules.
    const evalMs = await rig.page.evaluate(async ({ port }) => {
        const started = performance.now();
        await new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.src = `http://127.0.0.1:${port}/userScript.js`;
            el.onload = resolve;
            el.onerror = reject;
            document.head.appendChild(el);
        });
        return performance.now() - started;
    }, { port: rig.port });

    // Then the tail: everything the bundle set running. json.js re-walks the module
    // registry every 250ms for 15 seconds, and two modules poll for a <video>.
    const after = await harness.profile(rig.page, () => rig.page.waitForTimeout(16000), { interval: 1500 });

    const longest = await rig.page.evaluate(() => window.__longest || 0);

    console.log(`    parse + execute            ${ms(evalMs)}`);
    console.log(`    main thread, next 16s      ${ms(after.oursMs)} of ${ms(after.wall)} (${pctOf(after.ours, after.total)} of samples)`);
    if (longest) console.log(`    longest single task        ${ms(longest)}`);
    console.log('');
    console.log('      self%     time  where the tail goes');
    table(after.rows.filter(([n]) => n.indexOf('[vm]') === -1), after.total, after.wall, 8);

    await rig.close();
    return { evalMs, tailMs: after.oursMs };
}

/* --- navigation ------------------------------------------------------------------- */

// Runs in the page: twenty screen changes, each a browse response through whatever
// owns JSON.parse, then the DOM rebuilt the way a renderer would under whatever is
// observing it.
async function navigationRun(browse, rounds) {
    const text = JSON.stringify(browse);
    const stage = document.getElementById('stage');
    const times = [];

    for (let n = 0; n < rounds; n++) {
        const started = performance.now();

        location.hash = `#/browse?n=${n}`;
        const parsed = JSON.parse(text);

        const shelves = parsed.contents.tvBrowseRenderer.content
            .tvSurfaceContentRenderer.content.sectionListRenderer.contents;

        while (stage.firstChild) stage.removeChild(stage.firstChild);
        const frag = document.createDocumentFragment();
        shelves.forEach((shelf) => {
            const row = document.createElement('div');
            shelf.shelfRenderer.content.horizontalListRenderer.items.forEach((item) => {
                const cell = document.createElement('div');
                cell.textContent = item.tileRenderer
                    ? item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText
                    : '';
                row.appendChild(cell);
            });
            frag.appendChild(row);
        });
        stage.appendChild(frag);

        times.push(performance.now() - started);
        await new Promise((r) => setTimeout(r, 30));
    }

    times.sort((a, b) => a - b);
    return {
        mean: times.reduce((a, b) => a + b, 0) / times.length,
        median: times[Math.floor(times.length / 2)],
        worst: times[times.length - 1]
    };
}

async function navigation() {
    const ROUNDS = 20;
    const browse = harness.fixture(12, 15);
    ui.group(`navigation  (${ROUNDS} screen changes, 180 tiles each)`);

    // The same work with nobody hooking JSON.parse, as the floor. Attribution off the
    // sampler alone would over-count: our wrapper's self time contains the native parse
    // it delegates to, which is baseline cost either way.
    const bare = await harness.open(BUNDLE);
    let baseline;
    try {
        baseline = await bare.page.evaluate(
            ({ source, browse, rounds }) => new Function(`return (${source})`)()(browse, rounds),
            { source: navigationRun.toString(), browse, rounds: ROUNDS });
    } finally {
        await bare.close();
    }

    const rig = await harness.open(BUNDLE);
    let hooked;
    let result;
    try {
        await rig.load();
        await rig.page.waitForTimeout(1500);

        result = await harness.profile(rig.page, async () => {
            hooked = await rig.page.evaluate(
                ({ source, browse, rounds }) => new Function(`return (${source})`)()(browse, rounds),
                { source: navigationRun.toString(), browse, rounds: ROUNDS });
        }, { interval: 100 });
    } finally {
        await rig.close();
    }

    const row = (name, a, b) => console.log(`    ${name.padEnd(26)} ${String(a).padStart(9)}   ${String(b).padStart(9)}`);

    console.log(`    ${''.padEnd(26)} ${'bare'.padStart(9)}   ${'hooked'.padStart(9)}`);
    row('per navigation, median', ms(baseline.median), ms(hooked.median));
    row('per navigation, mean', ms(baseline.mean), ms(hooked.mean));
    row('worst', ms(baseline.worst), ms(hooked.worst));
    console.log('');
    console.log(`    our cost per navigation    ${ms(hooked.median - baseline.median)}`);
    console.log('');
    console.log('      self%     time  where it goes');
    table(result.rows.filter(([n]) => n.indexOf('[vm]') === -1), result.total, result.wall, 8);

    return { baseline, hooked };
}

/* --- playback --------------------------------------------------------------------- */

// Runs in the page.
//
// What threatens a frame during playback is main-thread occupancy, not decode: a Tizen
// set decodes 4K60 in fixed-function hardware, off this thread entirely, and no amount
// of JavaScript slows that down. What JavaScript does is hold the thread when the
// compositor wants it. So this reproduces the part the userscript can affect and states
// plainly what it does not:
//
//   real     a 60fps frame clock, the progress-bar churn YouTube performs continuously
//            while a video plays, and a calibrated per-frame budget standing in for
//            YouTube's own player work — state, progress, telemetry.
//   simulated the video element. Its currentTime advances against the wall clock and it
//            reports itself playing, which is what SponsorBlock's scheduling and its
//            progress-bar observer actually read. A media pipeline cannot be driven in
//            this environment: a captureStream-backed element crashes the renderer.
//
// So the decoder is not modelled and the frame counts are not a television's. Our share
// of the 16.7ms budget, and the length of the longest task, are what transfer.
async function playbackRun(seconds, frameWorkMs, withSegments, churn) {
    const video = document.querySelector('video');
    const startedAt = performance.now();

    // A video that reports itself playing. SponsorBlock reads exactly these two.
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    Object.defineProperty(video, 'currentTime', {
        configurable: true,
        get: () => (performance.now() - startedAt) / 1000,
        set: () => {}
    });
    Object.defineProperty(video, 'duration', { configurable: true, get: () => 600 });

    if (withSegments) {
        // What SponsorBlock installs once its segments arrive, which is what its
        // observer and its skip scheduling hang off.
        window.sponsorblock = window.sponsorblock || {
            segments: [
                { category: 'sponsor', segment: [5, 15], UUID: 'a' },
                { category: 'intro', segment: [0, 3], UUID: 'b' },
                { category: 'poi_highlight', segment: [30, 31], UUID: 'c' }
            ]
        };
        video.dispatchEvent(new Event('durationchange'));
        video.dispatchEvent(new Event('playing'));
    }

    const progressBar = document.querySelector('ytlr-redux-connect-ytlr-progress-bar');

    // A spin, not a sleep: the point is to hold the thread the way real work does.
    const burn = (budget) => {
        const until = performance.now() + budget;
        let sink = 0;
        while (performance.now() < until) sink += Math.sqrt(sink + 1);
        return sink;
    };

    let frames = 0;
    let late = 0;
    let worst = 0;
    let last = performance.now();
    const BUDGET = 1000 / 60;

    await new Promise((resolve) => {
        const tick = () => {
            const now = performance.now();
            const delta = now - last;
            last = now;

            frames++;
            // The first frame has no predecessor to be late against.
            if (frames > 1) {
                if (delta > BUDGET * 1.5) late++;
                if (delta > worst) worst = delta;
            }

            window.__sink = burn(frameWorkMs);

            // YouTube rewrites the progress bar continuously while a video plays — the
            // fill, the elapsed and remaining labels, the scrubber, the chapter marks.
            // This is the churn every observer in the userscript is charged for, and the
            // cost of a document-wide observer is proportional to it, so it is a knob
            // (--churn) rather than a constant.
            for (let i = 0; i < churn; i++) {
                const node = document.createElement('div');
                node.className = 'progress';
                node.style.width = `${(frames % 600) / 6}%`;
                node.appendChild(document.createTextNode(`${frames}`));
                progressBar.appendChild(node);
            }
            while (progressBar.childNodes.length > churn * 2) progressBar.removeChild(progressBar.firstChild);

            // A seek every couple of seconds, which is the one edge that re-arms
            // SponsorBlock's skip scheduling now that it no longer listens to timeupdate.
            if (frames % 120 === 0) video.dispatchEvent(new Event('seeked'));

            if (performance.now() - startedAt < seconds * 1000) requestAnimationFrame(tick);
            else resolve();
        };
        requestAnimationFrame(tick);
    });

    const elapsed = (performance.now() - startedAt) / 1000;

    return {
        seconds: elapsed,
        frames,
        fps: frames / elapsed,
        late,
        worstFrameMs: worst
    };
}

const inPage = (page, fn, arg) => page.evaluate(
    ({ source, arg }) => new Function(`return (${source})`)()(arg.seconds, arg.frameWorkMs, arg.withSegments, arg.churn),
    { source: fn.toString(), arg }
);

async function playback() {
    const SECONDS = Number(value('--seconds', 8) || 8);
    const FRAME_WORK = Number(value('--frame-work', 6) || 6);
    const CHURN = Number(value('--churn', 8) || 8);

    ui.group(`playback  (60fps clock, ${FRAME_WORK}ms/frame player work, ${CHURN} nodes/frame churn)`);

    // The same page and the same load without the script, as the floor.
    const bare = await harness.open(BUNDLE);
    let baseline;
    try {
        baseline = await inPage(bare.page, playbackRun,
            { seconds: SECONDS, frameWorkMs: FRAME_WORK, withSegments: false, churn: CHURN });
    } finally {
        await bare.close();
    }

    const rig = await harness.open(BUNDLE);
    let hooked;
    let result;
    try {
        await rig.load();
        await rig.page.waitForTimeout(1500);   // let the startup tail settle

        result = await harness.profile(rig.page, async () => {
            hooked = await inPage(rig.page, playbackRun,
                { seconds: SECONDS, frameWorkMs: FRAME_WORK, withSegments: true, churn: CHURN });
        }, { interval: 500 });
    } finally {
        await rig.close();
    }

    const row = (name, a, b) => console.log(`    ${name.padEnd(26)} ${String(a).padStart(9)}   ${String(b).padStart(9)}`);

    console.log(`    ${''.padEnd(26)} ${'bare'.padStart(9)}   ${'hooked'.padStart(9)}`);
    row('frames in ' + SECONDS + 's', baseline.frames, hooked.frames);
    row('effective fps', baseline.fps.toFixed(1), hooked.fps.toFixed(1));
    row('late frames (>1.5x budget)', baseline.late, hooked.late);
    row('worst frame gap', ms(baseline.worstFrameMs), ms(hooked.worstFrameMs));
    console.log('');
    console.log(`    our main-thread share      ${ms(result.oursMs)} over ${ms(result.wall)}  (${pctOf(result.ours, result.total)})`);
    console.log(`    per frame                  ${ms(result.oursMs / Math.max(hooked.frames, 1))} of the 16.7ms budget`);
    console.log('');
    console.log('      self%     time  where it goes');
    const oursOnly = result.rows.filter(([n]) => n.indexOf('[page]') === -1 && n.indexOf('[vm]') === -1);
    if (oursOnly.length) table(oursOnly, result.total, result.wall, 8);
    else console.log('      (nothing of ours was sampled)');

    return { baseline, hooked, oursMs: result.oursMs };
}

/* ---------------------------------------------------------------------------------- */

async function run() {
    ui.heading('profile');
    console.log(`  bundle   ${BUNDLE.replace(ROOT, '.')}\n`);

    const runners = { startup, navigation, playback };

    for (const name of SCENARIOS) {
        if (!runners[name]) {
            console.error(`  unknown scenario: ${name} (startup, navigation, playback)`);
            process.exit(1);
        }
        await runners[name]();
        console.log('');
    }
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
