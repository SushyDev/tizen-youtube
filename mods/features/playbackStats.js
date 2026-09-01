import { configRead } from '../config.js';

// The platform player counts no frames, so getVideoPlaybackQuality() reads zero and the
// stats line shows a dash. Time the video failed to advance converts to frames at the
// reported rate; real counts are passed through untouched.

// Below this a gap is sampling jitter, not a hitch worth reporting.
export const TOLERANCE = 0.02;

// A longer gap is a suspended app, not playback, so it is charged to nobody.
const MAX_GAP = 2;

const DEFAULT_FPS = 60;

/** What one sample interval adds, in seconds. `reseed` drops the baseline. */
export function account(previous, current) {
    const none = { played: 0, lost: 0, reseed: false };

    // A pause is not lost time and a seek's jump is not progress.
    if (!current || current.paused || current.seeking) return { played: 0, lost: 0, reseed: true };
    if (!previous) return none;

    const wall = (current.wall - previous.wall) / 1000;
    if (wall <= 0 || wall > MAX_GAP) return { played: 0, lost: 0, reseed: true };

    const advanced = current.media - previous.media;
    const expected = wall * (previous.rate || 1);

    // A backwards or wildly forward jump is a seek or a loop, whoever asked for it.
    if (advanced < 0 || advanced > expected * 4) return { played: 0, lost: 0, reseed: true };

    const missing = expected - advanced;

    return {
        played: Math.min(advanced, expected),
        // Starving counts too: trying to play and not playing is what a viewer notices.
        lost: missing > TOLERANCE ? missing : 0,
        reseed: false
    };
}

// One tally per element, or the start page's preview lands on the watch player's line.
const tallies = new WeakMap();

function tallyFor(video) {
    let tally = tallies.get(video);
    if (!tally) {
        tally = { played: 0, lost: 0, fps: DEFAULT_FPS, size: '', previous: null, watching: false };
        tallies.set(video, tally);
    }
    return tally;
}

/** The reported frame rate, re-read only on a size change: it moves with the rung. */
function frameRate(video, tally) {
    const size = video.videoWidth + 'x' + video.videoHeight;
    if (size === tally.size) return tally.fps;

    tally.size = size;

    const player = document.querySelector('#movie_player, .html5-video-player');
    try {
        const match = /@(\d+(?:\.\d+)?)/.exec(player.getStatsForNerds().resolution || '');
        if (match) tally.fps = parseFloat(match[1]) || tally.fps;
    } catch (e) { /* the player is not ready, or not this build */ }

    return tally.fps;
}

function sample(video) {
    const tally = tallyFor(video);

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
    tally.lost += step.lost;
    frameRate(video, tally);

    tally.previous = step.reseed ? null : current;
}

// timeupdate fires only while playing, where a timer would run all session to measure
// a paused player.
function watch(video) {
    const tally = tallyFor(video);
    if (tally.watching) return;

    tally.watching = true;
    video.addEventListener('timeupdate', () => sample(video));
    video.addEventListener('seeking', () => { tally.previous = null; });
    video.addEventListener('ratechange', () => { tally.previous = null; });
}

/** Substitutes derived counts when the renderer reports none, in the standard shape. */
export function install() {
    const proto = window.HTMLVideoElement && window.HTMLVideoElement.prototype;
    if (!proto || !proto.getVideoPlaybackQuality || proto.getVideoPlaybackQuality.__tube) return;

    // Captured at the document, so a video the page creates later needs no polling.
    document.addEventListener('play', (event) => {
        if (event.target instanceof window.HTMLVideoElement) watch(event.target);
    }, true);

    const original = proto.getVideoPlaybackQuality;

    function getVideoPlaybackQuality() {
        const real = original.apply(this, arguments);

        // The renderer is counting: its numbers are the true ones.
        if (!real || real.totalVideoFrames > 0) return real;

        watch(this);

        const tally = tallyFor(this);
        const dropped = Math.round(tally.lost * tally.fps);

        return {
            creationTime: real.creationTime,
            totalVideoFrames: Math.round(tally.played * tally.fps) + dropped,
            droppedVideoFrames: dropped,
            corruptedVideoFrames: 0,
            // Derived, not counted.
            tubeDerived: true
        };
    }

    getVideoPlaybackQuality.__tube = true;
    proto.getVideoPlaybackQuality = getVideoPlaybackQuality;
}

if (typeof window !== 'undefined' && configRead('reportPlaybackStats')) install();
