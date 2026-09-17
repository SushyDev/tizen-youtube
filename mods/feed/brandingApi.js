const API = 'https://sponsor.ajay.app/api/branding';

// Downvoted into the negative is DeArrow's way of saying "do not show this".
const showable = (entry) => entry && entry.votes >= 0 && !entry.original;

// Ties keep the earlier entry, which is the order the server sent.
const preferred = (entries) => (entries || [])
    .filter(showable)
    .reduce((best, one) => {
        if (!best) return one;
        if (!!best.locked !== !!one.locked) return best.locked ? best : one;
        return best.votes >= one.votes ? best : one;
    }, null);

const bestOf = (data) => {
    const title = preferred(data.titles);
    const thumbnail = preferred(data.thumbnails);

    return {
        title: title ? title.title : null,
        timestamp: thumbnail && typeof thumbnail.timestamp === 'number' ? thumbnail.timestamp : null
    };
};

const brandingFor = (videoID) => fetch(`${API}?videoID=${videoID}`)
    .then((res) => res.json())
    .then(bestOf);

const thumbnailUrl = (videoID, timestamp) =>
    `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoID}&time=${timestamp}`;

export { brandingFor, bestOf, thumbnailUrl };
