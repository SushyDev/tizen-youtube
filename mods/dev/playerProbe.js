import { DEV_TOOLS } from './tools.js';
import { note } from './journal.js';
import { onRequest, onResponse } from '../youtube/json.js';

// What the page asks YouTube for, and what comes back, in the only terms that decide
// whether this app can serve a video: whether the formats describe themselves before they
// are fetched, and what the request carried that YouTube grades a client by.
//
// Development only — `note` costs nothing when the journal is off. Read through the same
// interception every other feature uses: the player builds its requests inside a bundle
// that holds its own reference to JSON, so a patched `fetch` never sees them.

// What the last request for each video offered about who was asking, waiting for the
// answer that names formats. The player asks more than once — one of those is for a
// licence and carries no media — so the two halves are only worth a line together.
const asked = new Map();

// Read once, at load. `note` costs nothing when the journal is off, but this reads apart
// every player request and every response that names formats, and holds what it found until
// the pair can be written — work done for a reader that is not there. Nothing is registered
// at all unless somebody is going to read it.
const watching = DEV_TOOLS && typeof window !== 'undefined';

/** A player request, told apart from every other object with a `videoId` in it. */
if (watching) onRequest('playerProbe', ['videoId', 'context'], (body) => {
    if (!body.context || !body.videoId) return undefined;

    const integrity = body.serviceIntegrityDimensions || {};
    const playback = (body.playbackContext || {}).contentPlaybackContext || {};
    const client = body.context.client || {};

    // Kept whole, for reading out of the page: what makes one request come back with a
    // usable ladder and another with an encrypted one is a field, and which field is not
    // something a summary can answer.
    //
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

    // Read, never rewritten.
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
