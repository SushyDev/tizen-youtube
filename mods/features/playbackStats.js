import { configRead } from '../config.js';

// The platform player reports zero frames, so this measures lost time instead.

const TICK = 250;
const WINDOW = 30;

// A longer gap is a suspended app, not playback, so it is charged to nobody.
const MAX_GAP = 2;
const MOST_RECENT = (WINDOW * 1000) / TICK;

const DEFAULT_FPS = 60;
const MAX_PLAUSIBLE_FPS = 200;
const EMA = 0.3;

// Looking for the panel costs a walk of the document, and a closed panel never opens by itself —
// so a fruitless search backs off instead of repeating every two seconds for the whole video.
const FIND_EVERY = 2000;
const FIND_AT_MOST_EVERY = 30000;

const PLAYER = '#movie_player, .html5-video-player';
const MARK = 'data-tube-lost';

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

export function lostBy(tally) {
    if (!tally.recent || !tally.recent.length) {
        return Math.max(0, (tally.expected || 0) - (tally.advanced || 0));
    }

    const summed = tally.recent.reduce(
        (total, step) => ({ expected: total.expected + step.expected, advanced: total.advanced + step.advanced }),
        { expected: 0, advanced: 0 }
    );

    return Math.max(0, summed.expected - summed.advanced);
}

const tallies = new WeakMap();

const blank = () => ({
    expected: 0,
    advanced: 0,
    recent: [],
    fps: DEFAULT_FPS,
    width: -1,
    height: -1,
    previous: null,
    watching: false,
    timer: null,
    rate: 0,
    rateFrames: 0,
    rateAt: 0,
    node: null,
    label: null,
    lookedAt: 0,
    lookGap: FIND_EVERY
});

const tallyFor = (video) => {
    const held = tallies.get(video);
    if (held) return held;

    const made = blank();
    tallies.set(video, made);
    return made;
};

const latest = { reading: null };

export const measured = () => latest.reading;

// -- what the renderer says ----------------------------------------------------------------------

const playerElement = () => document.querySelector(PLAYER);

const measureRate = (video, tally, wall) => {
    // The prototype's own, so a patched getVideoPlaybackQuality is not averaged into itself.
    const proto = window.HTMLVideoElement && window.HTMLVideoElement.prototype;
    const real = proto && proto.getVideoPlaybackQuality;
    const quality = real ? real.call(video) : null;

    if (!quality || !quality.totalVideoFrames) return;

    const frames = quality.totalVideoFrames;
    const elapsed = wall - tally.rateAt;

    if (tally.rateAt && elapsed > 0) {
        const perSecond = ((frames - tally.rateFrames) * 1000) / elapsed;

        if (perSecond >= 0 && perSecond < MAX_PLAUSIBLE_FPS) {
            tally.rate = tally.rate ? tally.rate * (1 - EMA) + perSecond * EMA : perSecond;
        }
    }

    tally.rateFrames = frames;
    tally.rateAt = wall;
};

const frameRate = (video, tally) => {
    if (video.videoWidth === tally.width && video.videoHeight === tally.height) return;

    tally.width = video.videoWidth;
    tally.height = video.videoHeight;

    try {
        const found = /@(\d+(?:\.\d+)?)/.exec(playerElement().getStatsForNerds().resolution || '');
        if (found) tally.fps = parseFloat(found[1]) || tally.fps;
    } catch (e) { /* no panel, or a build that does not answer */ }
};

// -- the label on the stats panel ------------------------------------------------------------------

const framesNode = () => {
    const candidates = document.querySelectorAll('div, span, pre');

    for (let at = 0; at < candidates.length; at += 1) {
        const node = candidates[at];
        if (!node.children.length && node.textContent.indexOf('dropped of') !== -1) return node;
    }

    return null;
};

const said = (tally) => {
    const lost = lostBy(tally);
    const time = lost >= 0.05 ? `~${lost.toFixed(1)}s lost` : '~no time lost';

    return tally.rate ? `@ ${tally.rate.toFixed(2)} fps · ${time}` : time;
};

// The panel is re-rendered under us, so the label is found by its mark rather than remembered, and
// any duplicate a re-render left behind is removed.
const showRate = (tally, wall) => {
    if (!tally.node || !tally.node.isConnected) {
        if (wall - tally.lookedAt < tally.lookGap) return;

        tally.lookedAt = wall;
        tally.node = framesNode();

        if (!tally.node) {
            tally.lookGap = Math.min(tally.lookGap * 2, FIND_AT_MOST_EVERY);
            return;
        }

        tally.lookGap = FIND_EVERY;
    }

    const row = tally.node.parentNode;
    const already = row.querySelectorAll(`[${MARK}]`);

    for (let at = 1; at < already.length; at += 1) already[at].remove();

    tally.label = already[0] || null;

    if (!tally.label) {
        tally.label = document.createElement('span');
        tally.label.setAttribute(MARK, '');
        tally.label.style.cssText = 'display:inline;white-space:pre';
        row.insertBefore(tally.label, tally.node.nextSibling);
    }

    tally.label.textContent = `  ${said(tally)}`;
};

const dropLabel = (tally) => {
    if (tally.label && tally.label.parentNode) tally.label.parentNode.removeChild(tally.label);
    tally.label = null;
    tally.node = null;
};

// -- sampling ---------------------------------------------------------------------------------------

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

    tally.expected += step.expected;
    tally.advanced += step.advanced;
    tally.recent.push({ expected: step.expected, advanced: step.advanced });
    while (tally.recent.length > MOST_RECENT) tally.recent.shift();

    frameRate(video, tally);
    measureRate(video, tally, current.wall);
    showRate(tally, current.wall);

    latest.reading = {
        lost: +lostBy(tally).toFixed(3),
        window: WINDOW,
        rate: tally.rate ? +tally.rate.toFixed(2) : null,
        claimed: tally.fps
    };

    tally.previous = step.reseed ? null : current;
}

// A timer, not timeupdate: the platform player does not always fire it while advancing.
const watch = (video) => {
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
        Object.assign(tally, blank(), { watching: true });
        dropLabel(tally);
    };

    const forget = () => { tally.previous = null; };

    video.addEventListener('playing', start);
    video.addEventListener('pause', stop);
    video.addEventListener('ended', stop);
    video.addEventListener('loadstart', restart);
    video.addEventListener('emptied', restart);
    video.addEventListener('seeking', forget);
    video.addEventListener('ratechange', forget);

    if (!video.paused) start();
};

export function install() {
    document.addEventListener('play', (event) => {
        if (event.target instanceof window.HTMLVideoElement) watch(event.target);
    }, true);
}

export { WINDOW };

if (typeof window !== 'undefined' && configRead('reportPlaybackStats')) install();
