import { DEV_TOOLS, onRequest, onResponse } from '../../framework/index.js';
import { note } from './journal.js';

const held = { asked: {} };

const MOST_REMEMBERED = 32;

if (DEV_TOOLS && typeof window !== 'undefined') {
    onRequest('playerProbe', ['videoId', 'context'], (body) => {
        if (!body.context || !body.videoId) return undefined;

        const integrity = body.serviceIntegrityDimensions || {};
        const playback = (body.playbackContext || {}).contentPlaybackContext || {};
        const client = body.context.client || {};

        // The DRM licence request is shaped like the player request, so licenseRequest tells them apart.
        if (body.playbackContext && !body.licenseRequest) {
            try {
                window.__tubeAsked = JSON.stringify(body);
            } catch (e) {
                window.__tubeAsked = null;
            }

            const remembered = Object.keys(held.asked).length >= MOST_REMEMBERED ? {} : held.asked;

            held.asked = Object.assign({}, remembered, {
                [body.videoId]: {
                    token: integrity.poToken ? String(integrity.poToken).length : 0,
                    sts: playback.signatureTimestamp || 0,
                    drm: !!body.drmSystem,
                    client: `${client.clientName || '?'} ${client.clientVersion || '?'}`
                }
            });
        }

        return undefined;
    });

    onResponse('playerProbe', ['streamingData'], (response) => {
        const streaming = response.streamingData || {};
        const formats = streaming.adaptiveFormats || [];
        if (!formats.length) return;

        const videoId = (response.videoDetails || {}).videoId;
        const how = held.asked[videoId];
        held.asked = Object.keys(held.asked)
            .filter((id) => id !== videoId)
            .reduce((kept, id) => Object.assign({}, kept, { [id]: held.asked[id] }), {});

        const kinds = formats.reduce((counted, format) => {
            const kind = format.type === 'FORMAT_STREAM_TYPE_OTF' ? 'otf' : 'indexed';
            return Object.assign({}, counted, { [kind]: (counted[kind] || 0) + 1 });
        }, {});

        note('innertube', `${videoId}: asked as ${how ? how.client : 'unseen'} with `
            + `${how && how.token ? `a ${how.token}-byte token` : 'no token'}`
            + `${how && how.sts ? `, sts ${how.sts}` : ''}${how && how.drm ? ', drm' : ''}`
            + ` — got ${Object.keys(kinds).map((kind) => `${kinds[kind]} ${kind}`).join(', ')}`
            + `${streaming.serverAbrStreamingUrl ? ', abr offered' : ', no abr'}`
            + `${formats.some((format) => format.drmFamilies) ? ', drm formats' : ''}`);
    });
}
