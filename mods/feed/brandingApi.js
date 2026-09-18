import { sha256 } from '../../framework/index.js';

// Asks by a 4-character hash prefix, so the server never learns the video id — same scheme as
// mods/sponsorblock/segmentApi.js, and DeArrow's own client asks this way too.
const API = 'https://sponsor.ajay.app/api/branding';

// The server orders each list by its own community verdict — locked first, then highest-voted —
// so the client trusts the first entry rather than re-deriving an order of its own. A locked
// entry is never rejected for its vote count; only an unlocked, downvoted one is.
const isRejected = (entry) => !entry || (!entry.locked && entry.votes < 0);

// `original: true` is a real, votable answer meaning the community's verdict is to keep
// YouTube's own title or thumbnail — not an entry to skip past in favour of a lesser one.
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

// Unlike SponsorBlock's array-of-videos response, a hash covers several videos as one object
// keyed by videoID directly — confirmed live: fetching a real hash returns
// {"<id>": {"titles": [...], "thumbnails": [...], ...}, "<id2>": {...}, ...}.
const brandingFor = (videoID) => {
    const videoHash = sha256(videoID).substring(0, 4);

    return fetch(`${API}/${videoHash}`)
        .then((res) => res.json())
        .then((results) => bestOf((results && results[videoID]) || {}));
};

const thumbnailUrl = (videoID, timestamp) =>
    `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoID}&time=${timestamp}`;

export { brandingFor, bestOf, thumbnailUrl };
