import { configRead } from '../config.js';
import { fedByUs, servingNow } from './nativePlayback.js';

// The platform player reports zero frames, so this measures lost time instead.

export const TOLERANCE = 0.02;

// A longer gap is a suspended app, not playback, so it is charged to nobody.
const MAX_GAP = 2;

const DEFAULT_FPS = 60;

// Both sides, not their difference: shortfalls only add, so jitter would read as lost time.
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

export const WINDOW = 30;

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
    // The prototype's own, so a patched getVideoPlaybackQuality is not averaged into itself.
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

const CORRECTED = {
    Codecs: (now) => `${now.video.codecs} (${now.video.itag}) / ${now.audio.codecs} (${now.audio.itag})`,

    Color: (now) => (now.video.colour
        ? `${now.video.colour.transfer} / ${now.video.colour.primaries}`
        : null),

    Protected: () => 'no — served from this app'
};

// Every miss walks every div: uncached, four lookups a tick locked the television's interface.
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

function markPipeline(video, after) {
    const beside = valueBeside(after);
    if (!beside || !beside.parentNode) return;

    let row = added.get('Enhanced');

    if (!row || !row.value.isConnected) {
        // The whole row is cloned: inserting beside an existing pair lands inside that row.
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
    const cached = [...found.values()].some((node) => node && node.isConnected);
    if (!cached) {
        if (wall - searchedAt < FIND_EVERY) return;
        searchedAt = wall;
    }

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
    // Before the frames row is looked for: the enhanced player has none, so the rest never runs.
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

    // The player swaps elements without ending playback; a timer on a detached one keeps it alive.
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

// A timer, not timeupdate: the platform player does not always fire it while advancing.
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

export function install() {
    const proto = window.HTMLVideoElement && window.HTMLVideoElement.prototype;
    if (!proto) return;

    document.addEventListener('play', (event) => {
        if (event.target instanceof window.HTMLVideoElement) watch(event.target);
    }, true);
}

if (typeof window !== 'undefined' && configRead('reportPlaybackStats')) install();
