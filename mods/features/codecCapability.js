import { configRead } from '../config.js';

// What this television will admit to being able to decode.
//
// A set plays 4K60 in fixed-function hardware or it does not really play it at all. The
// webview does not know that. Chromium carries a software AV1 decoder, so every capability
// question about `av01` comes back yes on every set ever built, YouTube believes it, and
// the server sends AV1 4K60 HDR to a chip that then has to decode it on the CPU. On a real
// set that is ~10% of frames dropped with an eleven-second buffer and 70Mbit of spare
// bandwidth: nothing to do with the network, and nothing tuning elsewhere can win back.
//
// The official app does not have this problem because it asks the hardware rather than the
// browser. There are three ways to ask a browser and YouTube may use any of them, so all
// three are answered here:
//
//   navigator.mediaCapabilities.decodingInfo   the modern one, and the one that reports
//                                              `powerEfficient` — the platform saying
//                                              there is a hardware path
//   MediaSource.isTypeSupported                the old one, still consulted
//   HTMLMediaElement.canPlayType               the oldest
//
// Patching only `isTypeSupported` is not enough, which is the mistake this file made
// first: a client that asks `decodingInfo` gets the platform's own answer and offers AV1
// regardless of anything decided here.
//
// And because a set can claim a hardware path it does not really have — or have one that
// covers 8-bit but not the 10-bit HDR profile YouTube actually sends — the claim is
// checked against reality. If frames are being dropped while AV1 plays, that is the set
// answering the question properly, and the answer is remembered.

const AV1 = /(^|[^a-z])av0?1/i;
const VP9 = /vp0?9/i;
const AVC = /avc1|h264/i;

// Level 5.0 is where AV1 becomes 4K. Below that, software decode is a real option on a
// television and there is no reason to refuse it.
const FOUR_K_LEVEL = 12;

const VERDICT_KEY = 'tube.av1';

// 'hardware' — there is a real decoder and it keeps up.
// 'software' — there is not, or it does not.
// 'unknown'  — not yet established; treated as software, because that degrades to a codec
//              every 4K set decodes in hardware rather than to dropped frames.
let verdict = 'unknown';

function remember(next, why) {
    if (verdict === next) return;
    verdict = next;
    console.warn(`[tube] AV1 4K verdict: ${next} (${why})`);
    try {
        window.localStorage.setItem(VERDICT_KEY, next);
    } catch (e) { /* storage unavailable; the verdict still holds for this session */ }
}

/** The level index out of `av01.0.13M.10`, or null when it cannot be read. */
function av1Level(type) {
    const match = /av0?1\.(\d+)\.(\d+)/i.exec(type);
    return match ? parseInt(match[2], 10) : null;
}

/** Whether `type` names AV1 at 4K or above. */
function isBigAv1(type) {
    const text = String(type || '');
    if (!AV1.test(text)) return false;

    // Unreadable level: treat as 4K, because the string being refused is exactly the one
    // whose level could not be read.
    const level = av1Level(text);
    return level === null || level >= FOUR_K_LEVEL;
}

/**
 * Whether to keep claiming support for `type`.
 *
 * A named preference is the viewer overriding this outright, and is obeyed as given —
 * including a preference for AV1 on a set that will struggle with it, because someone who
 * picks a codec by name means it. `any` is where the hardware question is asked.
 */
function shouldClaim(type) {
    const preference = configRead('videoPreferredCodec');
    const text = String(type || '');

    // Audio is never the problem and must never be filtered: refusing the audio track
    // leaves a video that cannot be played at all.
    if (text.indexOf('audio/') === 0 || text.indexOf('audio') === 0) return true;

    if (preference && preference !== 'any') {
        if (preference === 'vp9') return !AV1.test(text) && !AVC.test(text);
        if (preference === 'av01') return !VP9.test(text) && !AVC.test(text);
        if (preference === 'avc1') return !VP9.test(text) && !AV1.test(text);
        return true;
    }

    if (verdict === 'hardware') return true;
    return !isBigAv1(text);
}

/** The same decision for a `streamingData` entry, which names its codec in a mimeType. */
function formatAllowed(mimeType) {
    return shouldClaim(mimeType);
}

/* --- asking the platform ---------------------------------------------------------- */

function probe() {
    try {
        const stored = window.localStorage.getItem(VERDICT_KEY);
        if (stored === 'hardware' || stored === 'software') {
            verdict = stored;
            console.warn(`[tube] AV1 4K verdict: ${stored} (remembered from a previous session)`);
            return;
        }
    } catch (e) { /* no storage; fall through to the probe */ }

    const capabilities = navigator.mediaCapabilities;
    if (!capabilities || typeof capabilities.decodingInfo !== 'function') {
        remember('software', 'this webview cannot be asked');
        return;
    }

    // Deliberately the profile YouTube actually sends a 4K HDR television: 10-bit, level
    // 5.1. A set can have a hardware path for 8-bit AV1 and none for this.
    capabilities.decodingInfo({
        type: 'media-source',
        video: {
            contentType: 'video/mp4; codecs="av01.0.13M.10"',
            width: 3840,
            height: 2160,
            bitrate: 20000000,
            framerate: 60
        }
    }).then((info) => {
        const efficient = !!(info && info.supported && info.powerEfficient);
        remember(efficient ? 'hardware' : 'software',
            `platform says supported=${info && info.supported} powerEfficient=${info && info.powerEfficient}`);
    }).catch((e) => remember('software', `the platform refused the question: ${e && e.message}`));
}

/* --- checking the platform's answer against reality -------------------------------- */

// A set that claims a hardware path it does not have looks exactly like one that has it,
// right up until frames start disappearing. Two percent is far above anything healthy
// playback produces and far below what a struggling AV1 decode produces; three windows in
// a row keeps a seek or a network stall from being mistaken for it.
const SAMPLE_MS = 2000;
const BAD_RATIO = 0.02;
const BAD_WINDOWS = 3;

function watchPlayback() {
    let last = null;
    let strikes = 0;

    setInterval(() => {
        if (verdict === 'software') return;   // nothing left to learn

        const video = document.querySelector('video');
        if (!video || video.paused || !video.getVideoPlaybackQuality) {
            last = null;
            return;
        }

        const quality = video.getVideoPlaybackQuality();
        const now = { total: quality.totalVideoFrames, dropped: quality.droppedVideoFrames };

        if (!last || now.total < last.total) {
            last = now;   // first sample, or the player restarted its counters
            return;
        }

        const frames = now.total - last.total;
        const dropped = now.dropped - last.dropped;
        last = now;

        // Too few frames to judge — buffering, or a still frame.
        if (frames < 30) return;

        if (dropped / frames <= BAD_RATIO) {
            strikes = 0;
            return;
        }

        // Only AV1 is worth blaming. When the codec cannot be read, the fact that AV1 is
        // currently permitted is enough: it is the only thing this file can act on.
        let codecs = '';
        try {
            const player = document.querySelector('.html5-video-player');
            const stats = player && player.getStatsForNerds && player.getStatsForNerds();
            codecs = (stats && stats.codecs) || '';
        } catch (e) { /* not available on this build */ }

        if (codecs && !AV1.test(codecs)) {
            strikes = 0;
            return;
        }

        strikes++;
        if (strikes >= BAD_WINDOWS) {
            remember('software',
                `dropping ${Math.round((dropped / frames) * 100)}% of frames while playing ${codecs || 'AV1'}`);
        }
    }, SAMPLE_MS);
}

/* --- installing ------------------------------------------------------------------- */

export default function installCodecCapability() {
    probe();

    // The modern channel, and the one a current YouTube client actually asks. Refusing
    // here is what keeps AV1 out of the capability set the server chooses from.
    try {
        const capabilities = navigator.mediaCapabilities;
        if (capabilities && typeof capabilities.decodingInfo === 'function') {
            const original = capabilities.decodingInfo.bind(capabilities);
            capabilities.decodingInfo = function (configuration) {
                const type = configuration
                    && configuration.video
                    && configuration.video.contentType;

                if (type && !shouldClaim(type)) {
                    return Promise.resolve({ supported: false, smooth: false, powerEfficient: false });
                }
                return original(configuration);
            };
        }
    } catch (e) {
        console.warn('Could not patch mediaCapabilities.decodingInfo:', e);
    }

    try {
        const source = window.MediaSource || window.WebKitMediaSource;
        if (source && source.isTypeSupported) {
            const original = source.isTypeSupported.bind(source);
            source.isTypeSupported = function (type) {
                if (!shouldClaim(type)) return false;
                return original(type);
            };
        }
    } catch (e) {
        console.warn('Could not patch MediaSource.isTypeSupported:', e);
    }

    try {
        const media = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
        if (media && media.canPlayType) {
            const original = media.canPlayType;
            media.canPlayType = function (type) {
                if (!shouldClaim(type)) return '';
                return original.call(this, type);
            };
        }
    } catch (e) {
        console.warn('Could not patch canPlayType:', e);
    }

    watchPlayback();
}

export { shouldClaim, formatAllowed };
