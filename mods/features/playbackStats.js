import { configRead } from '../config.js';

// Frame counts, on a set where nothing counts frames.
//
// `getVideoPlaybackQuality()` reports what the *renderer* composited. When the platform
// media player owns playback the renderer never sees a frame, so both counters sit at
// zero and YouTube's own stats line reads "1920x1080 / -". Nothing else knows either:
// requestVideoFrameCallback never fires, and Chromium's media-internals record for that
// path carries no decoder to ask.
//
// What can still be measured is whether media time keeps up with the wall clock — which
// is what dropped frames were being read as a proxy for. A second of wall time that
// advances the video by less than a second is time the viewer lost, and at a known frame
// rate that converts to frames.
//
// The numbers are therefore derived, not counted, and they are only ever substituted
// when the real ones are absent: if the renderer is compositing and reporting, its counts
// are passed through untouched.

const TICK = 250;

// Below this a gap is sampling jitter, not a hitch worth reporting.
export const TOLERANCE = 0.02;

// Two samples further apart than this are a suspended app or a throttled timer, not
// playback: what happened in between is unknowable, so it is not charged to anyone.
const MAX_GAP = 2;

/**
 * What one interval between samples adds to the running totals. Pure, so the arithmetic
 * can be tested without a video element.
 *
 * `previous` and `current` are { wall, media, rate, paused, seeking, readyState }.
 * Returns { played, lost, reseed } in seconds; `reseed` drops the baseline, for the
 * transitions where the gap means nothing.
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

const state = { played: 0, lost: 0, fps: 60 };
let previous = null;

/** The frame rate the player says it is running; the last known one otherwise. */
function frameRate() {
    const player = document.querySelector('#movie_player, .html5-video-player');
    try {
        const match = /@(\d+(?:\.\d+)?)/.exec(player.getStatsForNerds().resolution || '');
        if (match) return parseFloat(match[1]) || state.fps;
    } catch (e) { /* the player is not ready, or not this build */ }
    return state.fps;
}

function sample() {
    const video = document.querySelector('video');
    if (!video) { previous = null; return; }

    const current = {
        wall: Date.now(),
        media: video.currentTime,
        rate: video.playbackRate,
        paused: video.paused,
        seeking: video.seeking,
        readyState: video.readyState
    };

    const step = account(previous, current);
    state.played += step.played;
    state.lost += step.lost;
    state.fps = frameRate();

    previous = step.reseed ? null : current;
}

/**
 * Substitutes derived counts when the renderer reports none. The shape is the real
 * VideoPlaybackQuality one, so YouTube's stats line and anything else reading the
 * standard API get what they expect.
 */
export function install() {
    const proto = window.HTMLVideoElement && window.HTMLVideoElement.prototype;
    if (!proto || !proto.getVideoPlaybackQuality || proto.getVideoPlaybackQuality.__tube) return;

    const original = proto.getVideoPlaybackQuality;

    function getVideoPlaybackQuality() {
        const real = original.apply(this, arguments);

        // The renderer is compositing and counting: its numbers are the true ones.
        if (!real || real.totalVideoFrames > 0) return real;

        const dropped = Math.round(state.lost * state.fps);

        return {
            creationTime: real.creationTime,
            totalVideoFrames: Math.round(state.played * state.fps) + dropped,
            droppedVideoFrames: dropped,
            corruptedVideoFrames: 0,
            // Marks these as derived, for anything of ours that wants to know.
            tubeDerived: true
        };
    }

    getVideoPlaybackQuality.__tube = true;
    proto.getVideoPlaybackQuality = getVideoPlaybackQuality;
}

if (typeof window !== 'undefined' && configRead('reportPlaybackStats')) {
    install();
    setInterval(sample, TICK);
}
