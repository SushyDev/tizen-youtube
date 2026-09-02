import { configRead } from '../config.js';
import { note } from '../dev/journal.js';
import { onRequest, onResponse } from './json.js';

// Asks YouTube for media this app can actually serve.
//
// A player request carrying no `signatureTimestamp` is answered with formats that are
// transcoded as they are sent and encrypted with Widevine: no segment index to write a
// manifest from, and bytes a video element cannot decrypt on its own. The same request
// with the timestamp comes back with the ordinary ladder — indexed, unencrypted, and
// offering server-side ABR. Measured on the set, same video, same second:
//
//     no contentPlaybackContext  →  UNPLAYABLE, or 31 formats, all OTF, all DRM
//     signatureTimestamp only    →  32 formats, none OTF, none DRM, abr offered
//
// The player leaves it out. Nothing else in the request comes close to mattering as much.

// What the page last told YouTube, which is where this comes from: the timestamp belongs
// to the player script the page is running, and reading it from a request the page itself
// made is the only way to have the right one without parsing that script.
let timestamp = 0;

// The attestation the page minted, which is the other half of the answer. Signed out, a
// request carrying one is offered the ordinary ladder and a request without one is offered
// the encrypted set — measured on the set, four videos in a row:
//
//     with a 102-byte token  →  34 indexed, abr offered
//     with no token          →  19, 21, 33 formats, all OTF, all DRM
//
// The page mints one at startup and attaches it to the first player request it makes. Every
// request after that goes out without it, so the video someone actually chooses is the one
// that comes back unplayable.
let attestation = null;

const wanted = () => {
    try {
        return configRead('bypassMediaSource');
    } catch (e) {
        return false;
    }
};

/** A player request: the ones that fetch media, not the licence exchange shaped like one. */
const isPlayerRequest = (body) => Boolean(body
    && body.context
    && body.videoId
    && !body.licenseRequest);

onRequest('playerRequest', ['videoId', 'context'], (body) => {
    if (!isPlayerRequest(body)) return undefined;

    const playback = body.playbackContext || {};
    const content = playback.contentPlaybackContext || {};

    const integrity = body.serviceIntegrityDimensions || {};

    // The page does send both, on some of its requests. Remembering them is what lets the
    // rest be repaired.
    if (content.signatureTimestamp) timestamp = content.signatureTimestamp;
    if (integrity.poToken) attestation = integrity.poToken;

    if (!wanted()) return undefined;

    const needsTime = !content.signatureTimestamp && timestamp;
    const needsToken = !integrity.poToken && attestation;
    if (!needsTime && !needsToken) return undefined;

    note('innertube', `repairing ${body.videoId}: adding ${needsTime ? 'timestamp' : ''}`
        + `${needsTime && needsToken ? ' and ' : ''}${needsToken ? 'attestation' : ''}`);

    // A copy: the request is the player's, and it holds its own references to what it
    // passed in.
    const repaired = Object.assign({}, body);

    if (needsTime) {
        repaired.playbackContext = Object.assign({}, playback, {
            contentPlaybackContext: Object.assign({}, content, { signatureTimestamp: timestamp })
        });
    }

    if (needsToken) {
        repaired.serviceIntegrityDimensions = Object.assign({}, integrity, { poToken: attestation });
    }

    return repaired;
});

/** What has been learned, for anything that wants to say whether the repair can be made. */
export function knownTimestamp() {
    return timestamp;
}

/** Whether an attestation has been seen this session. */
export function haveAttestation() {
    return Boolean(attestation);
}

/**
 * Drops media the app cannot play, so it goes and asks for media it can.
 *
 * After the first video, this app stops calling `/youtubei/v1/player` altogether and takes
 * the streams embedded in the watch-next payload instead. Those are the encrypted,
 * index-less set on every video; the player call answers with the ordinary ladder every
 * time. Measured on the set — four videos in a row, only the first of which made a player
 * call, and only the first of which played here.
 *
 * Removing what cannot be served is what sends it back to the call that can be. The
 * response is the object the app itself is about to read, so this edits it in place.
 */
// Whether asking again has ever been worth it. Taking the streams away sends the app back
// to the player endpoint, which only helps if that endpoint answers with something this
// app can serve. Where it never does — every response encrypted — the app is left with no
// streams at all, asks again, is answered the same way, and gives up with an error.
//
// So this proves itself first: until one serveable response has been seen, nothing is
// taken away.
let everServed = false;

onResponse('playerRequest', ['streamingData'], (response) => {
    if (!wanted()) return;

    const formats = (response.streamingData || {}).adaptiveFormats;
    if (!Array.isArray(formats) || !formats.length) return;

    // Only when there is nothing here worth keeping. A response that carries an ordinary
    // picture is the one this app wants, and taking it away would be the opposite of help.
    const servable = formats.some((format) => /^video\/mp4/.test(format.mimeType || '')
        && format.height
        && !format.drmFamilies
        && format.type !== 'FORMAT_STREAM_TYPE_OTF');

    if (servable) {
        everServed = true;
        return;
    }

    if (!everServed) return;

    const videoId = (response.videoDetails || {}).videoId || 'this video';
    note('innertube', `dropping ${formats.length} unplayable formats for ${videoId}; `
        + 'the app has to ask the player endpoint again');

    delete response.streamingData;
});
