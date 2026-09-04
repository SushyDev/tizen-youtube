import { DEV_TOOLS } from './tools.js';
import { note } from './journal.js';
import { onRequest, onResponse } from '../youtube/json.js';

const asked = new Map();

const watching = DEV_TOOLS && typeof window !== 'undefined';

if (watching) onRequest('playerProbe', ['videoId', 'context'], (body) => {
    if (!body.context || !body.videoId) return undefined;

    const integrity = body.serviceIntegrityDimensions || {};
    const playback = (body.playbackContext || {}).contentPlaybackContext || {};
    const client = body.context.client || {};

    // The licence exchange is shaped like a player request and arrives last, so keeping
    // whichever came most recently keeps the wrong one. The one that names formats is the
    // one carrying a playback context.
    if (body.playbackContext && !body.licenseRequest) {
        try {
            window.__tubeAsked = JSON.stringify(body);
        } catch (e) {
            window.__tubeAsked = null;
        }
    }

    asked.set(body.videoId, {
        token: integrity.poToken ? String(integrity.poToken).length : 0,
        sts: playback.signatureTimestamp || 0,
        drm: !!body.drmSystem,
        client: `${client.clientName || '?'} ${client.clientVersion || '?'}`
    });

    return undefined;
});

if (watching) onResponse('playerProbe', ['streamingData'], (response) => {
    const streaming = response.streamingData || {};
    const formats = streaming.adaptiveFormats || [];
    if (!formats.length) return;

    const videoId = (response.videoDetails || {}).videoId;

    const kinds = {};
    formats.forEach((format) => {
        const kind = format.type === 'FORMAT_STREAM_TYPE_OTF' ? 'otf' : 'indexed';
        kinds[kind] = (kinds[kind] || 0) + 1;
    });

    const how = asked.get(videoId);
    asked.delete(videoId);

    note('innertube', `${videoId}: asked as ${how ? how.client : 'unseen'} with `
        + `${how && how.token ? `a ${how.token}-byte token` : 'no token'}`
        + `${how && how.sts ? `, sts ${how.sts}` : ''}${how && how.drm ? ', drm' : ''}`
        + ` — got ${Object.keys(kinds).map((kind) => `${kinds[kind]} ${kind}`).join(', ')}`
        + `${streaming.serverAbrStreamingUrl ? ', abr offered' : ', no abr'}`
        + `${formats.some((format) => format.drmFamilies) ? ', drm formats' : ''}`);
});
