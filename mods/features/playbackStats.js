import { configRead } from '../config.js';
import { fedByUs, servingNow } from './nativePlayback.js';

// The platform player counts no frames, so getVideoPlaybackQuality() reads zero and the
// stats line shows a dash. Time the video failed to advance converts to frames at the
// reported rate; real counts are passed through untouched.

// Below this a gap is sampling jitter, not a hitch worth reporting.
export const TOLERANCE = 0.02;

// A longer gap is a suspended app, not playback, so it is charged to nobody.
const MAX_GAP = 2;

const DEFAULT_FPS = 60;

/**
 * What one sample interval adds, in seconds. `reseed` drops the baseline.
 *
 * Both sides are returned rather than their difference, and the difference is taken over
 * the totals instead. Charging each sample's shortfall as it happens is what made this
 * unusable: only lag is charged, nothing credits the samples that catch up, and the
 * sampling timer's jitter is zero-mean — so summing the shortfalls of a signal whose total
 * shortfall is zero yields a large positive number.
 *
 * Measured against thirty seconds of this television's own playback: the media clock
 * advanced 29.751s against 29.751s expected — perfect — while the per-sample sum came to
 * 0.694s, which the old code reported as forty-one dropped frames. The deficit of the
 * totals is 0.000s. A one-second stall injected into the same data still shows in full.
 */
export function account(previous, current) {
    const none = { played: 0, expected: 0, advanced: 0, reseed: false };
    const drop = { played: 0, expected: 0, advanced: 0, reseed: true };

    // A pause is not lost time and a seek's jump is not progress.
    if (!current || current.paused || current.seeking) return drop;
    if (!previous) return none;

    const wall = (current.wall - previous.wall) / 1000;
    if (wall <= 0 || wall > MAX_GAP) return drop;

    const advanced = current.media - previous.media;
    const expected = wall * (previous.rate || 1);

    // A backwards or wildly forward jump is a seek or a loop, whoever asked for it.
    if (advanced < 0 || advanced > expected * 4) return drop;

    return { played: Math.min(advanced, expected), expected, advanced, reseed: false };
}

// How much of the recent past the reported figure covers. Long enough that a real stall
// stays visible while it matters, short enough that it stops being reported once playback
// has been fine for a while.
export const WINDOW = 30;

/**
 * Time the picture was trying to advance and did not, over the recent past.
 *
 * The deficit of the totals: exact, and self-correcting, because a sample that lags and a
 * sample that catches up cancel — which is what jitter does and what a stall does not.
 *
 * Over the *recent* totals, not the whole session. A cumulative figure is dominated for
 * ever by whatever happened at startup: measured here, a video reported six hundred
 * dropped frames for four minutes while losing nothing at all after the first few seconds.
 * A viewer reading that sees a number climbing against a picture that is plainly fine, and
 * correctly stops believing it.
 */
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

// How fast frames are actually arriving, smoothed, so a rung claiming 60 that delivers 48
// says so.
const EMA = 0.3;
const MAX_PLAUSIBLE_FPS = 200;

function measureRate(video, tally, wall) {
    // The renderer's own count, never the substitute below it. Reading the patched one
    // meant averaging numbers this module had invented from `fps` moments earlier, so the
    // figure shown as a measured frame rate reduced algebraically to the rate the player
    // claimed. Where the renderer counts nothing there is no rate to report, and saying so
    // is better than laundering a claim.
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

// The panel composes its frames line itself rather than calling getStatsForNerds, so the
// rate is shown beside it. Writing into the panel's own text made it blink: the panel
// rewrites that line on its refresh and we put it back a quarter second later. Our own
// element next to it is never rewritten, so there is nothing to lose the race to.
const FIND_EVERY = 2000;

// Rows the panel fills in from what the player selected. Once the picture comes from here
// that is no longer what reaches the decoder, and the panel goes on saying it — opus while
// the set plays AAC, AV1 while it plays VP9, protected while nothing is. Not merely useless
// but misleading, which is worse: every measurement read off it has to be thrown away.
//
// Each is written as a label and then its value, so the value is reached from the label
// rather than by recognising the shape of what is written in it.
const CORRECTED = {
    Codecs: (now) => `${now.video.codecs} (${now.video.itag}) / ${now.audio.codecs} (${now.audio.itag})`,

    Color: (now) => (now.video.colour
        ? `${now.video.colour.transfer} / ${now.video.colour.primaries}`
        : null),

    Protected: () => 'no — served from this app',

    // The player's own figures describe the copy it is fetching and discarding, which is
    // neither what is playing nor a measure of anything. Ours is the size of the stream
    // actually being decoded.
    'Connection Speed': (now) => `${Math.round((now.video.bitrate + now.audio.bitrate) / 1000)} Kbps of media`
};

/** The value beside a label, when the panel has written that row. */
function valueBeside(label) {
    if (!searchable()) return null;

    const all = document.querySelectorAll('div');

    for (let i = 0; i < all.length; i++) {
        const node = all[i];
        if (node.children.length !== 0) continue;
        if (node.textContent.trim() !== label) continue;

        const value = node.nextElementSibling;
        if (value && value.children.length === 0) return value;
    }

    return null;
}

/**
 * Rewrites the rows the panel cannot know the answer to.
 *
 * The panel refreshes on its own timer and puts its own text back, so this runs on the
 * same interval as the frame rate beside it and simply writes over it again. Only when
 * this app is the one feeding the element — otherwise the panel is right and should be
 * left alone.
 */
function correctRows(video) {
    if (pipelineOf(video) !== 'enhanced') return;

    const now = servingNow();
    if (!now || !now.video || !now.audio) return;

    Object.keys(CORRECTED).forEach((label) => {
        let said;
        try {
            said = CORRECTED[label](now);
        } catch (e) {
            return;
        }

        if (!said) return;

        const node = valueBeside(label);
        if (node && node.textContent !== said) node.textContent = said;
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

/**
 * Which pipeline is feeding the element.
 *
 * A stream served by this app comes from an address of its own; the player's own media
 * arrives through MediaSource as a blob. Worth saying on the line, because the two look
 * identical until you count frames.
 */
function pipelineOf(video) {
    const source = String(video.currentSrc || '');

    // Three of them now, and the third looks exactly like the player's own from here: when
    // this app feeds a MediaSource itself the element holds a blob address, the same as
    // YouTube's own pipeline. Saying "default" for it made the two indistinguishable on the
    // one line meant to tell them apart.
    if (source.indexOf('/dash/') !== -1) return 'enhanced';
    if (fedByUs()) return 'fed by the app';

    return 'default';
}

/**
 * What this module can honestly say about playback.
 *
 * Where the renderer counts frames, the rate is measured and the panel's own dropped-of
 * row is the truth. Where it counts nothing — which is this television, because
 * `use.game.mode` is left out of config.xml after it was found to drop frames — there is no
 * frame count to be had. What can be measured is *time*: how long the picture failed to
 * advance while it was trying to. That is the number reported, in the units it was
 * measured in, rather than multiplied by an assumed rate into frames nobody dropped.
 */
function said(tally) {
    // Sub-second precision would suggest a confidence this does not have.
    const lost = lostBy(tally);
    const time = lost >= 0.05 ? `~${lost.toFixed(1)}s lost` : '~no time lost';

    // Two different facts, and where both are known both are worth saying. A measured
    // rate below the rung's own says frames are not arriving; lost time says the clock
    // stopped. A stream can do either without the other.
    return tally.rate ? `@ ${tally.rate.toFixed(2)} fps · ${time}` : time;
}

function showRate(video, tally, wall) {
    if (!tally.node || !tally.node.isConnected) {
        if (wall - tally.lookedAt < FIND_EVERY) return;
        tally.lookedAt = wall;
        tally.node = framesNode();
        if (!tally.node) return;
    }

    // Re-inserted whenever the panel rebuilds the row around it.
    if (!tally.label || !tally.label.isConnected) {
        tally.label = document.createElement('span');
        tally.label.style.cssText = 'display:inline;white-space:pre';
        tally.node.parentNode.insertBefore(tally.label, tally.node.nextSibling);
    }

    tally.label.textContent = `  ${said(tally)} · ${pipelineOf(video)} player`;

    correctRows(video);
}

/** The reported frame rate, re-read only on a size change: it moves with the rung. */
function frameRate(video, tally) {
    if (video.videoWidth === tally.width && video.videoHeight === tally.height) return tally.fps;

    tally.width = video.videoWidth;
    tally.height = video.videoHeight;

    const player = document.querySelector('#movie_player, .html5-video-player');

    try {
        const match = /@(\d+(?:\.\d+)?)/.exec(player.getStatsForNerds().resolution || '');
        if (match) tally.fps = parseFloat(match[1]) || tally.fps;
    } catch (e) { /* the player is not ready, or not this build */ }

    return tally.fps;
}

export function sample(video) {
    const tally = tallyFor(video);

    // The player swaps its element without always ending playback on the old one, and a
    // timer holding a detached video keeps both alive for the rest of the session.
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

    // Kept as a window rather than a running total, so a stall ages out of the report the
    // way it ages out of what the viewer can see.
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

// What the last sample worked out, for anything measuring this app rather than watching
// it. The panel says the same thing, but reading it off the screen means parsing it back
// out of a sentence.
let latest = null;

export function measured() {
    return latest;
}

// Sampled on a timer that runs only while playing. timeupdate would be tidier, but the
// platform player advances currentTime without necessarily firing it, and that is the
// one path these counts exist for.
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

    // The player loads the next video into the same element, so without this the totals
    // are cumulative for the session where the stats line means them per video.
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

/**
 * Watches playback so the time it loses can be reported. Nothing is substituted.
 *
 * This used to answer `getVideoPlaybackQuality` with counts derived from lost time —
 * `dropped = lost × fps` — because the renderer answers zero on this hardware and the
 * panel's row shows a dash. That was a mistake, and an expensive one. Frames that were
 * never decoded or discarded were reported as dropped; a stall at startup was charged as
 * hundreds of them; and because the honest measure of lost time cancels as the clock
 * catches up, the "count" could fall as well as rise. A number that goes down is not a
 * count, and a viewer looking at a clean picture is right to disbelieve it.
 *
 * So the row keeps whatever the renderer actually knows, which here is nothing, and the
 * truth is put beside it in the units it was measured in.
 */
export function install() {
    const proto = window.HTMLVideoElement && window.HTMLVideoElement.prototype;
    if (!proto) return;

    // Captured at the document, so a video the page creates later needs no polling.
    document.addEventListener('play', (event) => {
        if (event.target instanceof window.HTMLVideoElement) watch(event.target);
    }, true);
}


if (typeof window !== 'undefined' && configRead('reportPlaybackStats')) install();
