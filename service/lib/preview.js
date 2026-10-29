'use strict';

const postmortem = require('./postmortem.js');

// Smart Hub's row of tiles under the app's own. The page asks YouTube for the recommendations made
// for that row on every start, and Smart Hub keeps whatever it was last handed, so they are handed
// over as they pass through us.
const LAUNCHER = 'FElauncher_recommendations';
const MOST = 20;

// Samsung asks for at least ten minutes between two updates.
const EVERY = 10 * 60 * 1000;

const held = { at: 0, sent: null, waiting: null, timer: null };

const largest = (images) => (images || [])
    .reduce((best, one) => (!best || (one.width || 0) > (best.width || 0) ? one : best), null);

const videoOf = (item) => {
    if (!item || !item.contentId) return null;

    const picture = largest(item.images);

    return {
        id: item.contentId,
        title: String(item.title || ''),
        channel: String(item.creator || ''),
        image: picture && /^https:\/\//.test(picture.uri)
            ? picture.uri
            : `https://i.ytimg.com/vi/${item.contentId}/mqdefault.jpg`
    };
};

const videosIn = (answer) => ((((answer && answer.contents) || {}).mediaActionsRenderer || {}).shelves || [])
    .reduce((all, shelf) => all.concat(shelf.shelfItems || []), [])
    .map(videoOf)
    .filter((video) => video)
    .filter((video, at, all) => all.findIndex((other) => other.id === video.id) === at)
    .slice(0, MOST);

const browseIdOf = (answer) => (((answer && answer.responseContext) || {}).serviceTrackingParams || [])
    .reduce((all, service) => all.concat(service.params || []), [])
    .filter((param) => param.key === 'browse_id')
    .map((param) => param.value)[0] || null;

// The deep link the built-in YouTube app declares to Smart Hub (launch_search_v.link).
const previewOf = (videos) => ({
    sections: [{
        title: 'Recommended',
        tiles: videos.map((video, at) => ({
            title: video.title,
            subtitle: video.channel,
            image_url: video.image,
            image_ratio: '16by9',
            action_data: `#play?v=${video.id}`,
            is_playable: true,
            position: at
        }))
    }]
});

const canPreview = () => typeof webapis !== 'undefined' && !!webapis.preview
    && typeof webapis.preview.setPreviewData === 'function';

const send = () => {
    held.timer = null;

    const json = held.waiting;
    held.waiting = null;
    if (!json || json === held.sent) return;

    held.at = Date.now();
    held.sent = json;

    try {
        webapis.preview.setPreviewData(json,
            () => postmortem.note('preview', `handed ${JSON.parse(json).sections[0].tiles.length} videos to Smart Hub`),
            (error) => postmortem.note('preview', `Smart Hub refused the row: ${(error && (error.message || error.name)) || error}`));
    } catch (e) {
        postmortem.note('preview', `could not hand the row over: ${postmortem.describe(e)}`);
    }
};

// Only the newest row is kept while an update has to wait.
const offer = (json) => {
    held.waiting = json;
    if (held.timer) return;

    held.timer = setTimeout(send, Math.max(0, held.at + EVERY - Date.now()));
};

const parsed = (text) => {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
};

const heard = (text) => {
    if (!canPreview() || String(text).indexOf(LAUNCHER) === -1) return;

    const answer = parsed(text);
    if (browseIdOf(answer) !== LAUNCHER) return;

    const videos = videosIn(answer);
    if (videos.length) offer(JSON.stringify(previewOf(videos)));
    else postmortem.note('preview', 'the recommendations for Smart Hub held no videos');
};

module.exports = { heard, videosIn, browseIdOf, previewOf };
