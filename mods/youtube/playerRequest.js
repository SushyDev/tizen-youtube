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

    if (!wanted() || content.signatureTimestamp || !timestamp) return undefined;

    if (!announced) {
        announced = true;
        note('innertube', `repairing player requests with signatureTimestamp ${timestamp}`);
    }

    return Object.assign({}, body, {
        playbackContext: Object.assign({}, playback, {
            contentPlaybackContext: Object.assign({}, content, { signatureTimestamp: timestamp })
        })
    });
});

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
