import { configRead } from '../config.js';

// What this television will admit to being able to decode.
//
// A set plays 4K60 in fixed-function hardware or it does not really play it at all. The
// webview does not know that. Chromium carries a software AV1 decoder, so
// `MediaSource.isTypeSupported` answers yes to `av01` on every set ever built, YouTube
// believes it, and the server sends AV1 4K60 HDR to a chip that then has to decode it on
// the CPU. On a real set that is ~10% of frames dropped, with an eleven-second buffer and
// 70Mbit of spare bandwidth: nothing whatever to do with the network, and not something
// any amount of tuning elsewhere in this app can win back.
//
// The official app never has this problem because it asks the hardware what it can do
// rather than asking the browser. The browser has a way to ask the same question —
// `mediaCapabilities.decodingInfo` reports `powerEfficient`, which is the platform saying
// "there is a hardware path for this" — so that is what decides here, rather than a list
// of model numbers that would be wrong by next year.
//
// This matters more than the format filter in adblock.js, which trims
// `streamingData.adaptiveFormats`. Playback is server-driven now (SABR): the server picks
// the format and the client's copy of the list is not what it picks from. Capability is.

const AV1 = /(^|[^a-z])av0?1/i;
const VP9 = /vp0?9/i;
const AVC = /avc1|h264/i;

// Level 5.0 is where AV1 becomes 4K. Below that, software decode is a real option on a
// television and there is no reason to refuse it.
const FOUR_K_LEVEL = 12;

/** The level index out of `av01.0.13M.10`, or null when it cannot be read. */
function av1Level(type) {
    const match = /av0?1\.(\d+)\.(\d+)/i.exec(type);
    return match ? parseInt(match[2], 10) : null;
}

// Answers arrive asynchronously and `isTypeSupported` is synchronous, so the probe is
// started at import — which, now that the userscript is registered against the document
// rather than evaluated into a live page, is before YouTube's player exists. Until it
// answers, AV1 at 4K is refused: that is the direction that degrades to a codec every
// 4K set decodes in hardware, rather than the one that drops frames.
let av1IsHardware = false;
let probed = false;

function probe() {
    const capabilities = navigator.mediaCapabilities;
    if (!capabilities || typeof capabilities.decodingInfo !== 'function') {
        // No way to ask. Refusing 4K AV1 costs a slightly higher VP9 bitrate; allowing it
        // on a set that cannot decode it costs one frame in ten.
        probed = true;
        return;
    }

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
        av1IsHardware = !!(info && info.supported && info.powerEfficient);
        probed = true;
        console.warn(`AV1 4K60: supported=${info && info.supported} powerEfficient=${info && info.powerEfficient}`);
    }).catch(() => {
        probed = true;
    });
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
    if (text.indexOf('audio/') === 0) return true;

    if (preference && preference !== 'any') {
        if (preference === 'vp9') return !AV1.test(text) && !AVC.test(text);
        if (preference === 'av01') return !VP9.test(text) && !AVC.test(text);
        if (preference === 'avc1') return !VP9.test(text) && !AV1.test(text);
        return true;
    }

    if (!AV1.test(text)) return true;
    if (av1IsHardware) return true;

    // Unreadable level: treat as 4K, because the string this app is trying to refuse is
    // exactly the one whose level it failed to read.
    const level = av1Level(text);
    return level !== null && level < FOUR_K_LEVEL;
}

export default function installCodecCapability() {
    probe();

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
}

export { shouldClaim, probed };
