import { configRead, configChangeEmitter } from '../config.js';
import { DEV_TOOLS } from '../dev/tools.js';
import { measured } from './playbackStats.js';
import { servingNow } from './nativePlayback.js';

const INTERVAL = 1000;

const LISTEN_EVERY = 200;

let timer = null;
let listener = null;

const servedByService = () => /^http:\/\/localhost:\d+$/.test(window.location.origin);

function reading() {
    const video = document.querySelector('video');
    const player = document.querySelector('#movie_player, .html5-video-player');
    if (!video) return { playing: false };

    const quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    let stats = {};
    try { stats = player.getStatsForNerds(); } catch (e) { }

    return {
        videoId: (function () {
            try { return player.getVideoData().video_id; } catch (e) { return null; }
        }()),
        route: location.hash.slice(0, 32),
        box: (function () {
            const rect = video.getBoundingClientRect();
            return Math.round(rect.width) + 'x' + Math.round(rect.height);
        }()),

        intrinsic: video.videoWidth + 'x' + video.videoHeight,
        resolution: stats.resolution || null,

        // Not `getStatsForNerds`, which reports what the player selected: it said `opus (251)`
        // through four minutes of AAC.
        codecs: (function () {
            const now = servingNow();
            if (!now || !now.video || !now.audio) return stats.codecs || null;
            return `${now.video.codecs} (${now.video.itag}) / ${now.audio.codecs} (${now.audio.itag})`;
        }()),
        colour: (function () {
            const now = servingNow();
            if (now && now.video && now.video.colour) {
                return `${now.video.colour.transfer} / ${now.video.colour.primaries}`;
            }
            return stats.color || null;
        }()),
        // From the element, not the player, whose own buffer nothing is playing from once the
        // picture comes from this app — it read 0.00s for half a minute while the video played on.
        buffer: (function () {
            try {
                const ranges = video.buffered;
                if (!ranges || !ranges.length) return '0.00 s';
                return `${(ranges.end(ranges.length - 1) - video.currentTime).toFixed(2)} s`;
            } catch (e) {
                return stats.buffer_health_seconds || null;
            }
        }()),

        quality: (function () {
            try { return player.getPlaybackQuality(); } catch (e) { return null; }
        }()),
        available: (function () {
            try { return (player.getAvailableQualityData() || []).map(function (e) { return e.qualityLabel; }); }
            catch (e) { return null; }
        }()),
        preferred: configRead('preferredVideoQuality'),

        frames: stats.dims_and_frames || null,
        decoded: quality ? quality.totalVideoFrames : null,
        dropped: quality ? quality.droppedVideoFrames : null,
        corrupted: quality ? quality.corruptedVideoFrames : null,
        derived: !!(quality && quality.tubeDerived),

        measured: measured(),

        evaluated: lastEval,
        mediaTime: +video.currentTime.toFixed(2),
        paused: video.paused,
        readyState: video.readyState
    };
}

let lastEval = null;

const AWAIT_FOR = 25000;

function settle(value) {
    if (!value || typeof value.then !== 'function') return Promise.resolve(value);

    return Promise.race([
        Promise.resolve(value),
        new Promise((_, fail) => setTimeout(() => fail(new Error('timed out waiting for a promise')), AWAIT_FOR))
    ]);
}

function describe(value) {
    if (typeof value === 'undefined') return 'undefined';

    try {
        return JSON.stringify(value);
    } catch (e) {
        try {
            return String(value);
        } catch (also) {
            return '[unprintable]';
        }
    }
}

function answer(id, source, outcome) {
    lastEval = Object.assign({ source }, outcome);

    if (!id) return;

    fetch('/__tube/dev/result', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({ id }, outcome))
    }).catch(() => { });
}

function collect() {
    fetch('/__tube/dev/commands')
        .then((response) => response.json())
        .then((body) => (body.commands || []).forEach((command) => {
            if (command.action !== 'eval') return;

            let value;
            try {
                // eslint-disable-next-line no-eval
                value = eval(command.source);
            } catch (e) {
                answer(command.id, command.source, { error: String(e && e.message || e) });
                return;
            }

            settle(value).then(
                (settled) => answer(command.id, command.source, { value: describe(settled) }),
                (failure) => answer(command.id, command.source, { error: String(failure && failure.message || failure) })
            );
        }))
        .catch(() => { });
}

function push() {
    let body;
    try { body = JSON.stringify(reading()); } catch (e) { return; }

    fetch('/__tube/dev/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body
    }).catch(() => { });
}

function apply(enabled) {
    if (!servedByService()) return;

    fetch(`/__tube/dev/enable?on=${enabled ? 1 : 0}`)
        .then((response) => response.json())
        .then((state) => console.log(`[tube] diagnostics ${state.open ? 'readable on :' + state.port : 'closed'}`))
        .catch(() => { });

    clearInterval(timer);
    clearInterval(listener);

    timer = enabled ? setInterval(push, INTERVAL) : null;
    listener = enabled ? setInterval(collect, LISTEN_EVERY) : null;
}

// Hung off the baked constant rather than off the setting, so a release build does not
// merely leave this switched off: nothing above is referenced and the minifier drops it.
if (DEV_TOOLS) {
    apply(configRead('enableDevBridge'));

    configChangeEmitter.addEventListener('configChange', (event) => {
        if (event.detail.key !== 'enableDevBridge') return;
        apply(event.detail.value);
    });
}
