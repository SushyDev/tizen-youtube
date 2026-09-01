import { configRead } from '../config.js';

// Frame counts for the path where the platform player owns playback and the renderer
// composites nothing, so getVideoPlaybackQuality() sits at zero and the stats line shows
// a dash where a television that counts its own frames shows figures.
//
// A second of wall time that advanced the video by less than a second is time the viewer
// lost, which at a known frame rate converts to frames. Real counts, when the renderer
// keeps any, are passed through untouched.

// Below this a gap is sampling jitter, not a hitch worth reporting.
export const TOLERANCE = 0.02;

// Two samples further apart than this are a suspended app or a throttled timer, not
// playback: what happened in between is unknowable, so it is not charged to anyone.
const MAX_GAP = 2;

const DEFAULT_FPS = 60;

/**
 * What one interval between samples adds to the running totals, in seconds. `reseed`
 * drops the baseline, for the transitions where the gap means nothing.
 */
export function account(previous, current) {
    const none = { played: 0, lost: 0, reseed: false };

    // Not trying to play: a pause is not lost time, and a seek's jump is not progress.
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
        // Starved of data counts too: the video is trying to play and is not, which is
        // exactly the time a viewer notices. Only the tolerance band is forgiven.
        lost: missing > TOLERANCE ? missing : 0,
        reseed: false
    };
}

// One tally per element. The start page keeps a preview player of its own, and a single
// shared tally let its figures land on the watch player's stats line.
const tallies = new WeakMap();

function tallyFor(video) {
    let tally = tallies.get(video);
    if (!tally) {
        tally = { played: 0, lost: 0, fps: DEFAULT_FPS, size: '', previous: null, watching: false };
        tallies.set(video, tally);
    }
    return tally;
}

/**
 * The frame rate the player reports, read only when the picture changes size. Asking on
 * every sample means a getStatsForNerds() call several times a second for a number that
 * only moves when the rung does.
 */
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

// timeupdate is the media element's own heartbeat: it fires while a video is playing and
// stops when it is not, which is exactly when there is something to count. A timer would
// run for the life of the session to spend most of it measuring a paused player.
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

    // Every video that starts playing gets counted, captured at the document so an element
    // the page creates later is caught without polling for it.
    document.addEventListener('play', (event) => {
        if (event.target instanceof window.HTMLVideoElement) watch(event.target);
    }, true);

    const original = proto.getVideoPlaybackQuality;

    function getVideoPlaybackQuality() {
        const real = original.apply(this, arguments);

        // The renderer is compositing and counting: its numbers are the true ones.
        if (!real || real.totalVideoFrames > 0) return real;

        watch(this);

        const tally = tallyFor(this);
        const dropped = Math.round(tally.lost * tally.fps);

        return {
            creationTime: real.creationTime,
            totalVideoFrames: Math.round(tally.played * tally.fps) + dropped,
            droppedVideoFrames: dropped,
            corruptedVideoFrames: 0,
            // Marks these as derived, for anything of ours that wants to know.
            tubeDerived: true
        };
    }

    getVideoPlaybackQuality.__tube = true;
    proto.getVideoPlaybackQuality = getVideoPlaybackQuality;
}

if (typeof window !== 'undefined' && configRead('reportPlaybackStats')) install();
