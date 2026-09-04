import { configRead } from '../config.js';
import { note } from '../dev/journal.js';
import { onRequest, onResponse } from './json.js';

// A player request without signatureTimestamp is answered with OTF, Widevine-encrypted formats:
// no segment index. The timestamp belongs to the page's player script, so it is harvested here.
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

const ASK_AGAIN_AT_MOST = 2;

const asked = new Map();

onResponse('playerRequest', ['streamingData'], (response) => {
    if (!wanted()) return;

    const formats = (response.streamingData || {}).adaptiveFormats;
    if (!Array.isArray(formats) || !formats.length) return;

    const videoId = (response.videoDetails || {}).videoId || 'this video';

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
