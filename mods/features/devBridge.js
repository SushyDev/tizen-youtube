import { configRead, configChangeEmitter } from '../config.js';
import { DEV_TOOLS } from '../dev/tools.js';
import { measured } from './playbackStats.js';
import { servingNow } from './nativePlayback.js';

// Pushes playback readings to the service, which publishes them to the network. What
// goes in the snapshot is decided here, and nothing comes back the other way. Only
// works on the proxy path, where the page and the service share an origin.

const INTERVAL = 1000;

// Commands are looked for more often than readings are pushed: a reading every second is
// plenty, but waiting a second to be asked a question makes an hour of poking unbearable.
const LISTEN_EVERY = 200;

let timer = null;
let listener = null;

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

        // What is being decoded, which once this app feeds the element is not what the
        // player selected. Left to `getStatsForNerds` this said `opus (251)` through four
        // minutes of AAC — the panel on screen is corrected, and a measurement taken from
        // here was reading the uncorrected rows.
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
        // From the element, not the player. `getStatsForNerds` reports the player's own
        // buffer, which once the picture comes from this app is a buffer nothing is
        // playing from — it read 0.00s for half a minute while the video played on.
        buffer: (function () {
            try {
                const ranges = video.buffered;
                if (!ranges || !ranges.length) return '0.00 s';
                return `${(ranges.end(ranges.length - 1) - video.currentTime).toFixed(2)} s`;
            } catch (e) {
                return stats.buffer_health_seconds || null;
            }
        }()),

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
        // `derived` should now always be false: nothing is substituted, so a non-zero
        // count here is the platform renderer's own and a zero means it counts nothing.
        frames: stats.dims_and_frames || null,
        decoded: quality ? quality.totalVideoFrames : null,
        dropped: quality ? quality.droppedVideoFrames : null,
        corrupted: quality ? quality.corruptedVideoFrames : null,
        derived: !!(quality && quality.tubeDerived),

        // What this app worked out on its own, beside what the renderer says, so the two
        // can be compared without reading either off the screen.
        measured: measured(),

        // Whether it is actually playing.
        evaluated: lastEval,
        mediaTime: +video.currentTime.toFixed(2),
        paused: video.paused,
        readyState: video.readyState
    };
}

// What the last evaluate returned, carried out in the reading.
let lastEval = null;

// How long to wait on an expression that answers with a promise. Most of what is worth
// asking this page is asynchronous — a request, a decode, a frame — and making every
// question a two-step dance through a global was most of the friction in using this.
const AWAIT_FOR = 25000;

/** Whatever it returned, resolved if it needs resolving, and always answered. */
function settle(value) {
    if (!value || typeof value.then !== 'function') return Promise.resolve(value);

    return Promise.race([
        Promise.resolve(value),
        new Promise((_, fail) => setTimeout(() => fail(new Error('timed out waiting for a promise')), AWAIT_FOR))
    ]);
}

/** Said as text, without throwing on something that cannot be stringified. */
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
    }).catch(() => { /* nothing waiting for it */ });
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
        .catch(() => { /* the service is not answering */ });
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
    clearInterval(listener);

    timer = enabled ? setInterval(push, INTERVAL) : null;
    listener = enabled ? setInterval(collect, LISTEN_EVERY) : null;
}

// Hung off the baked constant rather than off the setting, so a release build does not
// merely leave this switched off — nothing above is referenced, and the minifier drops the
// lot. Read from the setting it would otherwise be, so a build that does carry the tooling
// can still be turned off from the menu.
if (DEV_TOOLS) {
    apply(configRead('enableDevBridge'));

    configChangeEmitter.addEventListener('configChange', (event) => {
        if (event.detail.key !== 'enableDevBridge') return;
        apply(event.detail.value);
    });
}
