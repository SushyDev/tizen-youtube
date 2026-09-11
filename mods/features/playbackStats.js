import { configRead } from '../config.js';

// The platform player reports zero frames, so this measures lost time instead.

const TICK = 250;
const WINDOW = 30;

// A longer gap is a suspended app, not playback, so it is charged to nobody.
const MAX_GAP = 2;
const MOST_RECENT = (WINDOW * 1000) / TICK;
const MAX_JUMP_RATIO = 4;

const MAX_PLAUSIBLE_FPS = 200;
const EMA = 0.3;

// Each search walks every div, span and pre, so fruitless ones back off.
const FIND_EVERY = 2000;
const FIND_AT_MOST_EVERY = 30000;

const MARK = 'data-tube-lost';
const SHOWN_LOSS = 0.05;

// Both sides, not their difference: shortfalls only add, so jitter would read as lost time.
export function account(previous, current) {
    const none = { expected: 0, advanced: 0, reseed: false };
    const drop = { expected: 0, advanced: 0, reseed: true };

    if (!current || current.paused || current.seeking) return drop;
    if (!previous) return none;

    const wall = (current.wall - previous.wall) / 1000;
    if (wall <= 0 || wall > MAX_GAP) return drop;

    const advanced = current.media - previous.media;
    const expected = wall * (previous.speed || 1);

    if (advanced < 0 || advanced > expected * MAX_JUMP_RATIO) return drop;

    return { expected, advanced, reseed: false };
}

export function lostBy(tally) {
    const summed = tally.recent.reduce(
        (total, step) => ({ expected: total.expected + step.expected, advanced: total.advanced + step.advanced }),
        { expected: 0, advanced: 0 }
    );

    return Math.max(0, summed.expected - summed.advanced);
}

const tallies = new WeakMap();

const blank = () => ({
    recent: [],
    previous: null,
    watching: false,
    timer: null,
    decodedFps: 0,
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

const measureRate = (video, tally, wall) => {
    const proto = window.HTMLVideoElement && window.HTMLVideoElement.prototype;
    const real = proto && proto.getVideoPlaybackQuality;
    const quality = real ? real.call(video) : null;

    if (!quality || !quality.totalVideoFrames) return;

    const frames = quality.totalVideoFrames;
    const elapsed = wall - tally.rateAt;

    if (tally.rateAt && elapsed > 0) {
        const perSecond = ((frames - tally.rateFrames) * 1000) / elapsed;

        if (perSecond >= 0 && perSecond < MAX_PLAUSIBLE_FPS) {
            tally.decodedFps = tally.decodedFps ? tally.decodedFps * (1 - EMA) + perSecond * EMA : perSecond;
        }
    }

    tally.rateFrames = frames;
    tally.rateAt = wall;
};

const framesNode = () => {
    const isTheFramesLine = (node) => !node.children.length
        && node.textContent.indexOf('dropped of') !== -1;

    return Array.prototype.find.call(document.querySelectorAll('div, span, pre'), isTheFramesLine) || null;
};

const said = (tally) => {
    const lost = lostBy(tally);
    const time = lost >= SHOWN_LOSS ? `~${lost.toFixed(1)}s lost` : '~no time lost';

    return tally.decodedFps ? `@ ${tally.decodedFps.toFixed(2)} fps · ${time}` : time;
};

// The panel re-renders, so the label is re-found by MARK on every tick.
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

    Array.from(already).slice(1).forEach((duplicate) => duplicate.remove());

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

function sample(video) {
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
        speed: video.playbackRate,
        paused: video.paused,
        seeking: video.seeking
    };

    const step = account(tally.previous, current);

    tally.recent = tally.recent.concat([{ expected: step.expected, advanced: step.advanced }]).slice(-MOST_RECENT);

    measureRate(video, tally, current.wall);
    showRate(tally, current.wall);

    tally.previous = step.reseed ? null : current;
}

// A timer, not timeupdate: the platform player does not always fire it while advancing.
const watch = (video) => {
    if (tallyFor(video).watching) return;

    tallyFor(video).watching = true;

    const stop = () => {
        const tally = tallyFor(video);
        clearInterval(tally.timer);
        tally.timer = null;
        forget();
    };

    const start = () => {
        const tally = tallyFor(video);
        if (tally.timer || !configRead('reportPlaybackStats')) return;
        tally.timer = setInterval(() => sample(video), TICK);
    };

    const restart = () => {
        stop();
        dropLabel(tallyFor(video));
        tallies.set(video, { ...blank(), watching: true });
    };

    const forget = () => {
        const tally = tallyFor(video);
        tally.previous = null;
        tally.rateFrames = 0;
        tally.rateAt = 0;
    };

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

if (typeof window !== 'undefined') install();
