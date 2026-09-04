import { configRead } from '../config.js';
import { fedByUs, servingNow } from './nativePlayback.js';

// The platform player counts no frames, so `getVideoPlaybackQuality()` reads zero here.
// What can be measured instead is the time the picture failed to advance.

// Below this a gap is sampling jitter, not a hitch worth reporting.
export const TOLERANCE = 0.02;

// A longer gap is a suspended app, not playback, so it is charged to nobody.
const MAX_GAP = 2;

const DEFAULT_FPS = 60;

// Both sides are returned rather than their difference, which `lostBy` takes over the
// totals instead: the timer's jitter is zero-mean, so summing each sample's shortfall
// charges the lag and credits none of the catching up.
export function account(previous, current) {
    const none = { played: 0, expected: 0, advanced: 0, reseed: false };
    const drop = { played: 0, expected: 0, advanced: 0, reseed: true };

    if (!current || current.paused || current.seeking) return drop;
    if (!previous) return none;

    const wall = (current.wall - previous.wall) / 1000;
    if (wall <= 0 || wall > MAX_GAP) return drop;

    const advanced = current.media - previous.media;
    const expected = wall * (previous.rate || 1);

    if (advanced < 0 || advanced > expected * 4) return drop;

    return { played: Math.min(advanced, expected), expected, advanced, reseed: false };
}

// Seconds of the recent past the reported figure covers.
export const WINDOW = 30;

// Over the recent past rather than the whole session, which would be dominated for ever
// by whatever happened at startup.
export function lostBy(tally) {
    if (!tally.recent || !tally.recent.length) {
        return Math.max(0, (tally.expected || 0) - (tally.advanced || 0));
    }

    let expected = 0;
    let advanced = 0;

    for (let at = 0; at < tally.recent.length; at++) {
        expected += tally.recent[at].expected;
        advanced += tally.recent[at].advanced;
    }

    return Math.max(0, expected - advanced);
}

// One tally per element, or the start page's preview lands on the watch player's line.
const tallies = new WeakMap();

function tallyFor(video) {
    let tally = tallies.get(video);
    if (!tally) {
        tally = { played: 0, expected: 0, advanced: 0, recent: [], fps: DEFAULT_FPS, width: -1, height: -1, previous: null, watching: false, timer: null, rate: 0, rateFrames: 0, rateAt: 0, node: null, label: null, lookedAt: 0 };
        tallies.set(video, tally);
    }
    return tally;
}

const EMA = 0.3;
const MAX_PLAUSIBLE_FPS = 200;

function measureRate(video, tally, wall) {
    // The prototype's own count rather than whatever the page has put on the element, so a
    // patched one cannot be averaged back into a measurement of itself.
    const proto = window.HTMLVideoElement && window.HTMLVideoElement.prototype;
    const real = proto && proto.getVideoPlaybackQuality;
    const quality = real ? real.call(video) : null;

    if (!quality || !quality.totalVideoFrames) return;

    const frames = quality.totalVideoFrames;
    const elapsed = wall - tally.rateAt;

    if (tally.rateAt && elapsed > 0) {
        const perSecond = (frames - tally.rateFrames) * 1000 / elapsed;
        if (perSecond >= 0 && perSecond < MAX_PLAUSIBLE_FPS) {
            tally.rate = tally.rate ? tally.rate * (1 - EMA) + perSecond * EMA : perSecond;
        }
    }

    tally.rateFrames = frames;
    tally.rateAt = wall;
}

const FIND_EVERY = 2000;

// Rows the panel fills in from what the player selected, which is no longer what reaches
// the decoder once the picture comes from here — opus while the set plays AAC, AV1 while
// it plays VP9. Reached by label, since the panel writes each row as a label then a value.
const CORRECTED = {
    Codecs: (now) => `${now.video.codecs} (${now.video.itag}) / ${now.audio.codecs} (${now.audio.itag})`,

    Color: (now) => (now.video.colour
        ? `${now.video.colour.transfer} / ${now.video.colour.primaries}`
        : null),

    Protected: () => 'no — served from this app'
};

// Every lookup walks every div on the page, and the panel is closed almost all of the
// time. Called once per label per tick — four times a second — that was twelve full scans
// of a television's DOM every second, and it locked the interface: thumbnails stopped
// loading and the remote stopped answering. Found nodes are kept while they are connected,
// and nothing is searched for again until the interval below has passed.
const found = new Map();
let searchedAt = 0;

function valueBeside(label) {
    if (!searchable()) return null;

    const held = found.get(label);
    if (held && held.isConnected) return held;

    const all = document.querySelectorAll('div');

    for (let i = 0; i < all.length; i++) {
        const node = all[i];
        if (node.children.length !== 0) continue;
        if (node.textContent.trim() !== label) continue;

        const value = node.nextElementSibling;
        if (value && value.children.length === 0) {
            found.set(label, value);
            return value;
        }
    }

    found.delete(label);
    return null;
}

// The panel says nothing about which pipeline drew the picture, and the difference matters
// more than any row it does have: the same video, the same resolution, and one of them is
// this app's stream while the other is the page's own.
function markPipeline(video, after) {
    const beside = valueBeside(after);
    if (!beside || !beside.parentNode) return;

    let row = added.get('Enhanced');

    if (!row || !row.value.isConnected) {
        // The row is the element the label and value sit *inside*, not the panel. Adding a
        // label and value next to an existing pair puts them in that same row, which is why
        // this read as `Codecs av01... Enhanced yes` on one line. A whole row is cloned and
        // placed after the one it copied, so it inherits every class the layout depends on.
        const source = beside.parentNode;
        const copy = source.cloneNode(true);

        while (copy.children.length > 2) copy.removeChild(copy.lastElementChild);
        if (copy.children.length < 2) return;

        const name = copy.children[0];
        const value = copy.children[1];

        name.textContent = 'Enhanced';
        source.parentNode.insertBefore(copy, source.nextSibling);

        row = { name, value };
        added.set('Enhanced', row);
    }

    const pipeline = pipelineOf(video);
    const said = pipeline === 'enhanced' ? 'yes' : `no — ${pipeline} player`;

    if (row.value.textContent !== said) row.value.textContent = said;
}

const added = new Map();

function correctRows(video, wall) {
    // A row already found is rewritten every tick, which is cheap. Looking for one that is
    // not there is not, so that is only done occasionally.
    const cached = [...found.values()].some((node) => node && node.isConnected);
    if (!cached) {
        if (wall - searchedAt < FIND_EVERY) return;
        searchedAt = wall;
    }

    // Answered whichever pipeline is running, since "no" is the interesting answer.
    markPipeline(video, 'Codecs');

    if (pipelineOf(video) !== 'enhanced') return;

    const now = servingNow();
    if (!now || !now.video || !now.audio) return;

    const write = (node, said) => {
        if (node && said && node.textContent !== said) node.textContent = said;
    };

    Object.keys(CORRECTED).forEach((label) => {
        let said;
        try {
            said = CORRECTED[label](now, video);
        } catch (e) {
            return;
        }

        write(valueBeside(label), said);
    });
}

// Off the television this file is imported for its accounting alone, where there is no
// document to search.
const searchable = () => typeof document !== 'undefined' && !!document.querySelectorAll;

function framesNode() {
    if (!searchable()) return null;

    const all = document.querySelectorAll('div, span, pre');
    for (let i = 0; i < all.length; i++) {
        const node = all[i];
        if (node.children.length === 0 && node.textContent.indexOf('dropped of') !== -1) return node;
    }
    return null;
}

function pipelineOf(video) {
    const source = String(video.currentSrc || '');

    // Asked of the feeder rather than the address: when this app feeds a MediaSource itself
    // the element holds a blob, exactly as it does on YouTube's own pipeline.
    if (source.indexOf('/dash/') !== -1) return 'enhanced';
    if (fedByUs()) return 'fed by the app';

    return 'default';
}

function said(tally) {
    const lost = lostBy(tally);
    const time = lost >= 0.05 ? `~${lost.toFixed(1)}s lost` : '~no time lost';

    return tally.rate ? `@ ${tally.rate.toFixed(2)} fps · ${time}` : time;
}

function showRate(video, tally, wall) {
    // Before anything else, and not behind the frames row: that row is written by the
    // platform's own frame counter, which does not exist for a natively-played URL — so on
    // the enhanced player `framesNode` never finds anything and every correction below it
    // was dead. It worked on the default player, which is the one that does not need it.
    correctRows(video, wall);

    if (!tally.node || !tally.node.isConnected) {
        if (wall - tally.lookedAt < FIND_EVERY) return;
        tally.lookedAt = wall;
        tally.node = framesNode();
        if (!tally.node) return;
    }

    if (!tally.label || !tally.label.isConnected) {
        tally.label = document.createElement('span');
        tally.label.style.cssText = 'display:inline;white-space:pre';
        tally.node.parentNode.insertBefore(tally.label, tally.node.nextSibling);
    }

    tally.label.textContent = `  ${said(tally)} · ${pipelineOf(video)} player`;
}

function frameRate(video, tally) {
    if (video.videoWidth === tally.width && video.videoHeight === tally.height) return tally.fps;

    tally.width = video.videoWidth;
    tally.height = video.videoHeight;

    const player = document.querySelector('#movie_player, .html5-video-player');

    try {
        const match = /@(\d+(?:\.\d+)?)/.exec(player.getStatsForNerds().resolution || '');
        if (match) tally.fps = parseFloat(match[1]) || tally.fps;
    } catch (e) { }

    return tally.fps;
}

export function sample(video) {
    const tally = tallyFor(video);

    // The player swaps its element without always ending playback on the old one, and a timer
    // holding a detached video keeps both alive for the rest of the session.
    if (video.isConnected === false) {
        clearInterval(tally.timer);
        tally.timer = null;
        return;
    }

    const current = {
        wall: Date.now(),
        media: video.currentTime,
        rate: video.playbackRate,
        paused: video.paused,
        seeking: video.seeking,
        readyState: video.readyState
    };

    const step = account(tally.previous, current);
    tally.played += step.played;
    tally.expected += step.expected;
    tally.advanced += step.advanced;

    tally.recent.push({ expected: step.expected, advanced: step.advanced });
    while (tally.recent.length > (WINDOW * 1000) / TICK) tally.recent.shift();
    frameRate(video, tally);
    measureRate(video, tally, current.wall);
    showRate(video, tally, current.wall);

    latest = {
        lost: +lostBy(tally).toFixed(3),
        window: WINDOW,
        rate: tally.rate ? +tally.rate.toFixed(2) : null,
        claimed: tally.fps,
        pipeline: pipelineOf(video)
    };

    tally.previous = step.reseed ? null : current;
}

let latest = null;

export function measured() {
    return latest;
}

// Sampled on a timer rather than on `timeupdate`, which the platform player does not
// always fire even as it advances `currentTime`.
const TICK = 250;

function watch(video) {
    const tally = tallyFor(video);
    if (tally.watching) return;

    tally.watching = true;

    const stop = () => {
        clearInterval(tally.timer);
        tally.timer = null;
        tally.previous = null;
    };

    const start = () => {
        if (tally.timer) return;
        tally.timer = setInterval(() => sample(video), TICK);
    };

    // The player loads the next video into the same element, so without this the totals are
    // cumulative for the session where the stats line means them per video.
    const restart = () => {
        stop();
        tally.played = 0;
        tally.expected = 0;
        tally.advanced = 0;
        tally.recent = [];
        tally.width = -1;
        tally.height = -1;
        tally.rate = 0;
        tally.rateAt = 0;
        tally.node = null;
        if (tally.label && tally.label.parentNode) tally.label.parentNode.removeChild(tally.label);
        tally.label = null;
    };

    video.addEventListener('playing', start);
    video.addEventListener('pause', stop);
    video.addEventListener('ended', stop);
    video.addEventListener('loadstart', restart);
    video.addEventListener('emptied', restart);
    video.addEventListener('seeking', () => { tally.previous = null; });
    video.addEventListener('ratechange', () => { tally.previous = null; });

    if (!video.paused) start();
}

// `getVideoPlaybackQuality` is left alone: lost time cancels as the clock catches up, so
// a frame count derived from it can fall as well as rise, which no count does.
export function install() {
    const proto = window.HTMLVideoElement && window.HTMLVideoElement.prototype;
    if (!proto) return;

    document.addEventListener('play', (event) => {
        if (event.target instanceof window.HTMLVideoElement) watch(event.target);
    }, true);
}

if (typeof window !== 'undefined' && configRead('reportPlaybackStats')) install();
