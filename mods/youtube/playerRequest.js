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

// A client version to ask as, when the one this app is running is being answered with media
// it cannot serve.
//
// The encrypted ladder is an experiment YouTube runs against accounts on the `tv` client —
// the same account is served ordinary media on a phone or a desktop browser in the same
// minute, so it is the client that is enrolled, not the person. Which version of that
// client is the only part of it this app can honestly vary.
//
// Empty means ask as ourselves, which is what ships. A year-old version was measured and
// changed nothing — the same account is answered with the encrypted ladder whichever
// version asks — so this is kept only because it is the one honest lever left if the
// experiment ever becomes version-scoped.
const ASK_AS_VERSION = '';

// What the page last told YouTube, which is where this comes from: the timestamp belongs
// to the player script the page is running, and reading it from a request the page itself
// made is the only way to have the right one without parsing that script.
let timestamp = 0;

// Said once: the rewrite runs on every player request and a line each would bury the
// journal in one sentence.
let announced = false;

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

/**
 * Repairs a player request that is missing the signature timestamp.
 *
 * Removing the proof-of-origin token was tried here, on a measurement that showed the
 * encrypted ladder arriving with the field present and the ordinary one with it absent —
 * four times in a row, same video, same minute, through the app's own credentials. It does
 * not replicate: repeated later, the same body gave the encrypted ladder ten times out of
 * ten either way. The window that produced it was not something this code controlled, and
 * most likely belonged to a different account being signed in at the time.
 *
 * So nothing is taken out. What is known about the encrypted ladder is in
 * docs/formats-and-tokens.md, and none of it is reachable from here.
 */
onRequest('playerRequest', ['videoId', 'context'], (body) => {
    if (!isPlayerRequest(body)) return undefined;

    const playback = body.playbackContext || {};
    const content = playback.contentPlaybackContext || {};

    // The timestamp belongs to the player script the page is running, so it is remembered
    // from a request the page made rather than invented.
    if (content.signatureTimestamp) timestamp = content.signatureTimestamp;

    if (!wanted()) return undefined;

    const client = body.context.client || {};
    const needsTime = !content.signatureTimestamp && timestamp;
    const needsVersion = ASK_AS_VERSION && client.clientVersion !== ASK_AS_VERSION;

    if (!needsTime && !needsVersion) return undefined;

    if (!announced) {
        announced = true;
        note('innertube', `repairing player requests with signatureTimestamp ${timestamp}`);
    }

    const repaired = Object.assign({}, body);

    if (needsTime) {
        repaired.playbackContext = Object.assign({}, playback, {
            contentPlaybackContext: Object.assign({}, content, { signatureTimestamp: timestamp })
        });
    }

    if (needsVersion) {
        repaired.context = Object.assign({}, body.context, {
            client: Object.assign({}, client, { clientVersion: ASK_AS_VERSION })
        });
    }

    return repaired;
});

/** What has been learned, for anything that wants to say whether the repair can be made. */
export function knownTimestamp() {
    return timestamp;
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
// How many times one video may be sent back to the player endpoint.
//
// Taking the streams away only helps if that endpoint answers with something this app can
// serve. Where it never does — every response encrypted — the app would be left with no
// streams at all, ask again, be answered the same way, and give up with an error.
//
// This used to be guarded by having seen one serveable response *at some point*, which is
// a condition a cold start cannot meet. Opening a video straight from the launch screen
// takes the streams embedded in the watch-next payload, which are the encrypted set on
// every video, and with nothing served yet they were kept — so the first video of every
// session played through the default player, and the enhanced one only ever appeared
// after something else had already worked. Measured on the set: hash-routed straight to a
// watch page, `21 otf, drm formats`, default player, buffer at zero and a hundred and
// fifty frames dropped in twenty seconds.
//
// A budget rather than a proof, so the first video of a session gets the same chance as
// the second, and a video that genuinely has nothing to serve still falls back after two.
const ASK_AGAIN_AT_MOST = 2;

const asked = new Map();

onResponse('playerRequest', ['streamingData'], (response) => {
    if (!wanted()) return;

    const formats = (response.streamingData || {}).adaptiveFormats;
    if (!Array.isArray(formats) || !formats.length) return;

    const videoId = (response.videoDetails || {}).videoId || 'this video';

    // Only when there is nothing here worth keeping. A response that carries an ordinary
    // picture is the one this app wants, and taking it away would be the opposite of help.
    const servable = formats.some((format) => /^video\/mp4/.test(format.mimeType || '')
        && format.height
        && !format.drmFamilies
        && format.type !== 'FORMAT_STREAM_TYPE_OTF');

    if (servable) {
        asked.delete(videoId);
        return;
    }

    const spent = asked.get(videoId) || 0;

    if (spent >= ASK_AGAIN_AT_MOST) {
        if (spent === ASK_AGAIN_AT_MOST) {
            asked.set(videoId, spent + 1);
            note('innertube', `${videoId} is answered with nothing serveable however it is `
                + 'asked; letting the page play what it was given');
        }
        return;
    }

    asked.set(videoId, spent + 1);

    note('innertube', `dropping ${formats.length} unplayable formats for ${videoId}; `
        + 'the app has to ask the player endpoint again');

    delete response.streamingData;
});
