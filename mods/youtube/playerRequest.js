import { configRead } from '../config.js';
import { note } from '../dev/journal.js';
import { onRequest, onResponse } from './json.js';

// A player request carrying no `signatureTimestamp` is answered with formats that are
// transcoded as they are sent and encrypted with Widevine: no segment index to write a
// manifest from. Measured on the set, same video, same second:
//
//   no contentPlaybackContext   UNPLAYABLE, or 31 formats, all OTF, all DRM
//   signatureTimestamp only     32 formats, none OTF, none DRM, abr offered
//
// The player leaves it out.

// A client version to ask as. The encrypted ladder is an experiment YouTube runs against
// accounts on the `tv` client, so the version is the only part of it this app can vary.
// Empty means ask as ourselves; a year-old version was measured and changed nothing.
const ASK_AS_VERSION = '';

// The timestamp belongs to the player script the page is running, so it is remembered
// from a request the page made rather than invented.
let timestamp = 0;

let announced = false;

const wanted = () => {
    try {
        return configRead('bypassMediaSource');
    } catch (e) {
        return false;
    }
};

const isPlayerRequest = (body) => Boolean(body
    && body.context
    && body.videoId
    && !body.licenseRequest);

onRequest('playerRequest', ['videoId', 'context'], (body) => {
    if (!isPlayerRequest(body)) return undefined;

    const playback = body.playbackContext || {};
    const content = playback.contentPlaybackContext || {};

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

export function knownTimestamp() {
    return timestamp;
}

// How many times one video may be sent back to the player endpoint.
//
// A budget rather than a proof that something has been served before, which a cold start
// cannot meet: opening a video straight from the launch screen takes the encrypted
// streams embedded in the watch-next payload, so the first video of every session used to
// play through the default player. Measured on the set, hash-routed straight to a watch
// page: `21 otf, drm formats`, buffer at zero, a hundred and fifty frames dropped in
// twenty seconds.
const ASK_AGAIN_AT_MOST = 2;

const asked = new Map();

onResponse('playerRequest', ['streamingData'], (response) => {
    if (!wanted()) return;

    const formats = (response.streamingData || {}).adaptiveFormats;
    if (!Array.isArray(formats) || !formats.length) return;

    const videoId = (response.videoDetails || {}).videoId || 'this video';

    // Only when there is nothing here worth keeping: a response carrying an ordinary picture
    // is the one this app wants.
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
