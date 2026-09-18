import { sha256 } from '../../framework/index.js';

// Asks by a 4-character hash prefix so the server never learns the video id.
const API = 'https://sponsor.ajay.app/api/branding';

// A lock overrides vote count — it's the community's finalized verdict.
const isRejected = (entry) => !entry || (!entry.locked && entry.votes < 0);

// Server output is already sorted by verdict, so the first entry wins without re-sorting.
// `original: true` means keep YouTube's own pick, not fall back to a runner-up.
const preferred = (entries) => {
    const top = (entries || [])[0];
    return isRejected(top) || top.original ? null : top;
};

const bestOf = (data) => {
    const title = preferred(data.titles);
    const thumbnail = preferred(data.thumbnails);

    return {
        title: title ? title.title : null,
        timestamp: thumbnail && typeof thumbnail.timestamp === 'number' ? thumbnail.timestamp : null
    };
};

// The response is keyed by videoID, since one hash prefix can match several videos.
const brandingFor = (videoID) => {
    const videoHash = sha256(videoID).substring(0, 4);

    return fetch(`${API}/${videoHash}`)
        .then((res) => res.json())
        .then((results) => bestOf((results && results[videoID]) || {}));
};

const thumbnailUrl = (videoID, timestamp) =>
    `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoID}&time=${timestamp}`;

export { brandingFor, bestOf, thumbnailUrl };
