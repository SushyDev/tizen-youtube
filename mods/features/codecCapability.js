import { configRead } from '../config.js';

// What this television can actually play, learned rather than assumed.
//
// The first version of this file blamed AV1, on the evidence of a set dropping 10% of
// frames while decoding AV1 4K60 HDR. Forcing VP9 on the same set and the same video
// dropped 24% — worse. So the codec was never the thing. What both formats had in common
// was the part that does not appear in the codec name people quote:
//
//     av01.0.13M.10     AV1,  level 5.1, 10-bit      smpte2084 (PQ) / bt2020
//     vp09.02.51.10     VP9,  profile 2, 10-bit      smpte2084 (PQ) / bt2020
//
// Ten-bit HDR at 4K60. A television has a hardware path for that — it is the whole point
// of the panel — but the *webview* need not be wired to it, and a browser will fall back
// to decoding on the CPU without telling anybody. That is the difference against the app
// Samsung ships, which uses the platform's media pipeline rather than Chromium's.
//
// So this no longer takes a position on codecs. It describes a format by the three things
// that decide whether a decoder can keep up — family, resolution class, bit depth — asks
// the platform about each combination, and then checks the answer against the frames the
// set actually manages. When they disagree, the frames win, and what was learned is
// remembered so a set works this out once rather than every launch.

const AV1 = /(^|[^a-z])av0?1/i;
const VP9 = /vp0?9/i;
const AVC = /avc1|h264/i;

// Buckets, in the order they are given up. Ten-bit goes first because it is the one that
// costs a decoder the most and a picture the least: SDR 4K60 still looks like 4K60.
const HDR_4K = 'hdr4k';     // more than 8-bit, at 4K
const UHD_60 = 'uhd60';     // 4K at 60fps, any depth
const LADDER = [HDR_4K, UHD_60];

const EXCLUSIONS_KEY = 'tube.decode';

// What this set has been found unable to keep up with. Empty means nothing ruled out yet.
let excluded = [];

function isExcluded(bucket) {
    return excluded.indexOf(bucket) !== -1;
}

function exclude(bucket, why) {
    if (isExcluded(bucket)) return false;

    excluded = excluded.concat(bucket);
    console.warn(`[tube] decode: giving up ${bucket} — ${why}`);

    try {
        window.localStorage.setItem(EXCLUSIONS_KEY, excluded.join(','));
    } catch (e) { /* storage unavailable; it still holds for this session */ }

    return true;
}

/* --- reading a codec string -------------------------------------------------------- */

// `vp09.02.51.10` is profile 02, level 5.1, 10-bit.
// `av01.0.13M.10` is profile 0, level 13 (5.1), Main tier, 10-bit.
// H.264 as YouTube ships it is always 8-bit.
//
// The level is what says 4K, and whether it is 60fps: VP9 5.1 and AV1 13 are 4K60, one
// step below each is 4K30. Neither the resolution nor the frame rate appears anywhere
// else in the string, which is why this is read rather than guessed.
function describe(type) {
    const text = String(type || '');

    const vp9 = /vp0?9\.(\d+)\.(\d+)(?:\.(\d+))?/i.exec(text);
    if (vp9) {
        const level = parseInt(vp9[2], 10);
        return {
            family: 'vp9',
            depth: vp9[3] ? parseInt(vp9[3], 10) : 8,
            fourK: level >= 50,
            fourK60: level >= 51
        };
    }

    const av1 = /av0?1\.(\d+)\.(\d+)[A-Za-z]?(?:\.(\d+))?/i.exec(text);
    if (av1) {
        const level = parseInt(av1[2], 10);
        return {
            family: 'av1',
            depth: av1[3] ? parseInt(av1[3], 10) : 8,
            fourK: level >= 12,
            fourK60: level >= 13
        };
    }

    if (AVC.test(text)) return { family: 'avc', depth: 8, fourK: false, fourK60: false };

    // Something unrecognised, and an unreadable string is not evidence of anything: let
    // it through rather than refuse a format this does not understand.
    return null;
}

/* --- the decision ------------------------------------------------------------------ */

/**
 * Whether to keep claiming support for `type`.
 *
 * A named codec preference is the viewer overriding this outright and is obeyed as given,
 * because someone who picks a codec by name means it. It does not override what the set
 * has been found unable to decode, though: that is not a preference, it is a fact about
 * the hardware, and honouring it is the difference between 1440p that plays and 2160p
 * that stutters.
 */
function shouldClaim(type) {
    const text = String(type || '');

    // Audio is never the problem and must never be filtered: refusing the audio track
    // leaves a video that cannot be played at all.
    if (text.indexOf('audio') === 0) return true;

    const preference = configRead('videoPreferredCodec');
    if (preference && preference !== 'any') {
        if (preference === 'vp9' && (AV1.test(text) || AVC.test(text))) return false;
        if (preference === 'av01' && (VP9.test(text) || AVC.test(text))) return false;
        if (preference === 'avc1' && (VP9.test(text) || AV1.test(text))) return false;
    }

    const format = describe(text);
    if (!format) return true;

    if (isExcluded(HDR_4K) && format.depth > 8 && format.fourK) return false;
    if (isExcluded(UHD_60) && format.fourK60) return false;

    return true;
}

/** The same decision for a `streamingData` entry, which names its codec in a mimeType. */
function formatAllowed(mimeType) {
    return shouldClaim(mimeType);
}

/* --- asking the platform ----------------------------------------------------------- */

const CANDIDATES = [
    ['VP9 4K60 SDR', 'video/webm; codecs="vp09.00.51.08"'],
    ['VP9 4K60 HDR', 'video/webm; codecs="vp09.02.51.10"'],
    ['AV1 4K60 SDR', 'video/mp4; codecs="av01.0.13M.08"'],
    ['AV1 4K60 HDR', 'video/mp4; codecs="av01.0.13M.10"']
];

// The probe is a starting position, not the last word. It is logged in full because when
// this file gets it wrong, this is the only thing on a television that says why.
function probe(ask) {
    let pending = CANDIDATES.length;
    let anyHdrEfficient = false;

    CANDIDATES.forEach(([label, contentType]) => {
        ask({
            type: 'media-source',
            video: { contentType, width: 3840, height: 2160, bitrate: 20000000, framerate: 60 }
        }).then((info) => {
            const supported = !!(info && info.supported);
            const efficient = !!(info && info.powerEfficient);
            console.warn(`[tube] decode probe: ${label} supported=${supported} powerEfficient=${efficient}`);
            if (efficient && contentType.indexOf('.10') !== -1) anyHdrEfficient = true;
        }).catch(() => {
            console.warn(`[tube] decode probe: ${label} refused the question`);
        }).then(() => {
            pending--;
            if (pending === 0 && !anyHdrEfficient) {
                exclude(HDR_4K, 'no hardware path for 10-bit at 4K on this set');
            }
        });
    });
}

/* --- checking the answer against reality ------------------------------------------- */

// A set can claim a hardware path it does not have, or have one for 8-bit and none for
// the 10-bit HDR the panel exists to show. Both look identical to the platform's own
// answer, and neither looks like anything at all until frames start disappearing.
//
// Two percent is far above what healthy playback produces and far below what a struggling
// decode produces. Three windows in a row keeps a seek or a network stall out of it.
const SAMPLE_MS = 2000;
const BAD_RATIO = 0.02;
const BAD_WINDOWS = 3;

function watchPlayback() {
    let last = null;
    let strikes = 0;

    setInterval(() => {
        // Nothing left on the ladder to give up.
        if (LADDER.every(isExcluded)) return;

        const video = document.querySelector('video');
        if (!video || video.paused || !video.getVideoPlaybackQuality) {
            last = null;
            return;
        }

        const quality = video.getVideoPlaybackQuality();
        const now = { total: quality.totalVideoFrames, dropped: quality.droppedVideoFrames };

        // First sample, or the player restarted its counters for a new video.
        if (!last || now.total < last.total) {
            last = now;
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

        strikes++;
        if (strikes < BAD_WINDOWS) return;
        strikes = 0;

        const percent = Math.round((dropped / frames) * 100);
        const next = LADDER.find((bucket) => !isExcluded(bucket));
        exclude(next, `dropping ${percent}% of frames`);
    }, SAMPLE_MS);
}

/* --- installing -------------------------------------------------------------------- */

export default function installCodecCapability() {
    try {
        const stored = window.localStorage.getItem(EXCLUSIONS_KEY);
        if (stored) {
            excluded = stored.split(',').filter((entry) => LADDER.indexOf(entry) !== -1);
            if (excluded.length) console.warn(`[tube] decode: ${excluded.join(', ')} ruled out previously`);
        }
    } catch (e) { /* no storage; start from nothing known */ }

    // Three ways a browser can be asked, and a client may use any of them. Patching only
    // `isTypeSupported` does nothing to a client that asks `decodingInfo`, which is the
    // modern one and the one that reports `powerEfficient` — that was the mistake the
    // first version of this file made.
    try {
        const capabilities = navigator.mediaCapabilities;
        if (capabilities && typeof capabilities.decodingInfo === 'function') {
            const original = capabilities.decodingInfo.bind(capabilities);

            capabilities.decodingInfo = function (configuration) {
                const type = configuration && configuration.video && configuration.video.contentType;
                if (type && !shouldClaim(type)) {
                    return Promise.resolve({ supported: false, smooth: false, powerEfficient: false });
                }
                return original(configuration);
            };

            probe(original);
        } else {
            console.warn('[tube] decode: this webview cannot be asked about decoding');
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

export { shouldClaim, formatAllowed, describe };
