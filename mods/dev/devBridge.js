import { configChangeEmitter, configRead } from '../../framework/index.js';

const REPORT_EVERY = 1000;
const LISTEN_EVERY = 200;
const AWAIT_FOR = 25000;
const REPORTED_UP_TO = 32 * 1024;

const PLAYER = '#movie_player, .html5-video-player';

const held = { report: null, listen: null, lastEval: null };

// The proxy writes __TUBE_NATIVE_PROXY_PATCHES__ into every page it serves, whatever origin the
// page keeps.
export const servedByService = () => typeof window.__TUBE_NATIVE_PROXY_PATCHES__ !== 'undefined';

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

        evaluated: held.lastEval,

        mediaTime: +video.currentTime.toFixed(2),
        paused: video.paused,
        readyState: video.readyState
    };
};

const settle = (value, wait) => {
    if (!value || typeof value.then !== 'function') return Promise.resolve(value);

    return Promise.race([
        Promise.resolve(value),
        new Promise((_, fail) => setTimeout(() => fail(new Error('timed out waiting for a promise')), wait))
    ]);
};

const describe = (value) => {
    if (typeof value === 'undefined') return 'undefined';

    return safely(() => JSON.stringify(value), safely(() => String(value), '[unprintable]'));
};

const reason = (failure) => String((failure && failure.message) || failure);

const clipped = (text) => (typeof text === 'string' ? text.slice(0, REPORTED_UP_TO) : text);

const answer = (id, source, outcome) => {
    held.lastEval = { source: clipped(source), value: clipped(outcome.value), error: clipped(outcome.error) };

    if (!id) return undefined;

    return post('/__tube/dev/result', JSON.stringify(Object.assign({ id }, outcome)));
};

const run = (command) => {
    const evaluate = (source) => {
        try {
            return { ok: (0, eval)(source) };
        } catch (e) {
            return { failed: e };
        }
    };

    const value = evaluate(command.source);

    if (value.failed) return answer(command.id, command.source, { error: reason(value.failed) });

    return settle(value.ok, command.wait || AWAIT_FOR).then(
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

    clearInterval(held.report);
    clearInterval(held.listen);

    held.report = enabled ? setInterval(report, REPORT_EVERY) : null;
    held.listen = enabled ? setInterval(collect, LISTEN_EVERY) : null;
};

// The DEV_TOOLS guard moved to dev/index.js, which is what registers this; a release build never
// reaches it and terser drops the module whole.
const start = () => {
    apply(configRead('enableDevBridge'));

    configChangeEmitter.addEventListener('configChange', (event) => {
        if (event.detail.key === 'enableDevBridge') apply(event.detail.value);
    });
};

export { start };
