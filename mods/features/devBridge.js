import { configRead, configChangeEmitter } from '../config.js';

// Pushes playback readings to the service, which publishes them to the network. What
// goes in the snapshot is decided here, and nothing comes back the other way. Only
// works on the proxy path, where the page and the service share an origin.

const INTERVAL = 1000;

let timer = null;

const servedByService = () => /^http:\/\/localhost:\d+$/.test(window.location.origin);

/** Everything worth knowing about playback, and nothing that is not ours to send. */
function reading() {
    const video = document.querySelector('video');
    const player = document.querySelector('#movie_player, .html5-video-player');
    if (!video) return { playing: false };

    const quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    let stats = {};
    try { stats = player.getStatsForNerds(); } catch (e) { /* not this build, or not ready */ }

    return {
        // What is on screen.
        videoId: (function () {
            try { return player.getVideoData().video_id; } catch (e) { return null; }
        }()),
        route: location.hash.slice(0, 32),
        box: (function () {
            const rect = video.getBoundingClientRect();
            return Math.round(rect.width) + 'x' + Math.round(rect.height);
        }()),

        // What it is playing.
        intrinsic: video.videoWidth + 'x' + video.videoHeight,
        resolution: stats.resolution || null,
        codecs: stats.codecs || null,
        colour: stats.color || null,
        buffer: stats.buffer_health_seconds || null,

        // Which rung it settled on, against the rungs it was actually offered. A player
        // sitting below the best on a healthy buffer has been capped, not starved, and
        // the two lists together say by whom.
        quality: (function () {
            try { return player.getPlaybackQuality(); } catch (e) { return null; }
        }()),
        available: (function () {
            try { return (player.getAvailableQualityData() || []).map(function (e) { return e.qualityLabel; }); }
            catch (e) { return null; }
        }()),
        preferred: configRead('preferredVideoQuality'),

        // Whether anything is counting frames, which is the question this was built for.
        frames: stats.dims_and_frames || null,
        decoded: quality ? quality.totalVideoFrames : null,
        dropped: quality ? quality.droppedVideoFrames : null,
        derived: !!(quality && quality.tubeDerived),

        // Whether it is actually playing.
        mediaTime: +video.currentTime.toFixed(2),
        paused: video.paused,
        readyState: video.readyState
    };
}

function push() {
    let body;
    try { body = JSON.stringify(reading()); } catch (e) { return; }

    fetch('/__tube/dev/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body
    }).catch(() => { /* the service will report the reading as stale */ });
}

function apply(enabled) {
    if (!servedByService()) return;

    fetch(`/__tube/dev/enable?on=${enabled ? 1 : 0}`)
        .then((response) => response.json())
        .then((state) => console.log(`[tube] diagnostics ${state.open ? 'readable on :' + state.port : 'closed'}`))
        .catch(() => { /* nothing to report to */ });

    clearInterval(timer);
    timer = enabled ? setInterval(push, INTERVAL) : null;
}

apply(configRead('enableDevBridge'));

configChangeEmitter.addEventListener('configChange', (event) => {
    if (event.detail.key !== 'enableDevBridge') return;
    apply(event.detail.value);
});
