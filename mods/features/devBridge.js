import { configRead, configChangeEmitter } from '../config.js';
import { DEV_TOOLS } from '../dev/tools.js';
import { measured } from './playbackStats.js';

const REPORT_EVERY = 1000;
const LISTEN_EVERY = 200;
const AWAIT_FOR = 25000;

const PLAYER = '#movie_player, .html5-video-player';

const timers = { report: null, listen: null };
const held = { lastEval: null };

// Any plain-HTTP origin with a port is this service: it is the only thing that serves the app. Not
// just localhost — inside Cobalt's container the page arrives by the set's network address,
// because one package cannot reach another's loopback.
const servedByService = () => /^http:\/\/[^/]+:\d+$/.test(window.location.origin);

const safely = (read, fallback) => {
    try {
        const value = read();
        return value === undefined ? fallback : value;
    } catch (e) {
        return fallback;
    }
};

const post = (path, body) => fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
}).catch(() => { });

const reading = () => {
    const video = document.querySelector('video');
    if (!video) return { playing: false };

    const player = document.querySelector(PLAYER);
    const quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    const stats = safely(() => player.getStatsForNerds(), {});

    const buffered = safely(() => {
        const ranges = video.buffered;
        if (!ranges || !ranges.length) return '0.00 s';

        return `${(ranges.end(ranges.length - 1) - video.currentTime).toFixed(2)} s`;
    }, stats.buffer_health_seconds || null);

    return {
        videoId: safely(() => player.getVideoData().video_id, null),
        route: window.location.hash.slice(0, 32),
        box: safely(() => {
            const rect = video.getBoundingClientRect();
            return `${Math.round(rect.width)}x${Math.round(rect.height)}`;
        }, null),

        intrinsic: `${video.videoWidth}x${video.videoHeight}`,
        resolution: stats.resolution || null,
        codecs: stats.codecs || null,
        colour: stats.color || null,
        buffer: buffered,

        quality: safely(() => player.getPlaybackQuality(), null),
        available: safely(() => (player.getAvailableQualityData() || []).map((e) => e.qualityLabel), null),
        preferred: configRead('preferredVideoQuality'),

        frames: stats.dims_and_frames || null,
        decoded: quality ? quality.totalVideoFrames : null,
        dropped: quality ? quality.droppedVideoFrames : null,
        corrupted: quality ? quality.corruptedVideoFrames : null,
        derived: !!(quality && quality.tubeDerived),

        measured: measured(),
        evaluated: held.lastEval,

        mediaTime: +video.currentTime.toFixed(2),
        paused: video.paused,
        readyState: video.readyState
    };
};

const settle = (value) => {
    if (!value || typeof value.then !== 'function') return Promise.resolve(value);

    return Promise.race([
        Promise.resolve(value),
        new Promise((_, fail) => setTimeout(() => fail(new Error('timed out waiting for a promise')), AWAIT_FOR))
    ]);
};

const describe = (value) => {
    if (typeof value === 'undefined') return 'undefined';

    return safely(() => JSON.stringify(value), safely(() => String(value), '[unprintable]'));
};

const reason = (failure) => String((failure && failure.message) || failure);

const answer = (id, source, outcome) => {
    held.lastEval = Object.assign({ source }, outcome);

    if (!id) return undefined;

    return post('/__tube/dev/result', JSON.stringify(Object.assign({ id }, outcome)));
};

const run = (command) => {
    const value = (() => {
        try {
            return { ok: eval(command.source) };
        } catch (e) {
            return { failed: e };
        }
    })();

    if (value.failed) return answer(command.id, command.source, { error: reason(value.failed) });

    return settle(value.ok).then(
        (settled) => answer(command.id, command.source, { value: describe(settled) }),
        (failure) => answer(command.id, command.source, { error: reason(failure) })
    );
};

const collect = () => fetch('/__tube/dev/commands')
    .then((response) => response.json())
    .then((body) => (body.commands || []).forEach((command) => {
        if (command.action === 'eval') run(command);
    }))
    .catch(() => { });

const report = () => {
    const body = safely(() => JSON.stringify(reading()), null);
    if (body) post('/__tube/dev/report', body);
};

const apply = (enabled) => {
    if (!servedByService()) return;

    fetch(`/__tube/dev/enable?on=${enabled ? 1 : 0}`)
        .then((response) => response.json())
        .then((state) => console.log(`[tube] diagnostics ${state.open ? `readable on :${state.port}` : 'closed'}`))
        .catch(() => { });

    clearInterval(timers.report);
    clearInterval(timers.listen);

    timers.report = enabled ? setInterval(report, REPORT_EVERY) : null;
    timers.listen = enabled ? setInterval(collect, LISTEN_EVERY) : null;
};

// Hung off the baked constant, not the setting, so a release build drops all of this.
if (DEV_TOOLS) {
    apply(configRead('enableDevBridge'));

    configChangeEmitter.addEventListener('configChange', (event) => {
        if (event.detail.key === 'enableDevBridge') apply(event.detail.value);
    });
}
