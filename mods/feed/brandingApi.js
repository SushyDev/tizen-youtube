// What DeArrow says about a video, and which of its answers to believe.
//
// The API returns every submission with its vote count, and picking the highest-voted one is not
// what DeArrow itself does — which is why this used to choose entries that could not be shown.
//
// Read off the live API for dQw4w9WgXcQ, the thumbnails are:
//
//   votes=2  locked=true   original=false  timestamp=3.92349     <- what DeArrow shows
//   votes=9  locked=false  original=true   timestamp=null        <- what votes alone picked
//   votes=6  locked=false  original=false  timestamp=3.742979
//
// The winner on votes is the *original* thumbnail, whose timestamp is null, so the caller's
// `if (data.timestamp)` was false and no thumbnail was ever applied. A locked entry is a moderator
// decision and outranks any number of votes; an original entry is YouTube's own and is not a
// substitution at all.

const API = 'https://sponsor.ajay.app/api/branding';

// Downvoted into the negative is DeArrow's way of saying "do not show this".
const showable = (entry) => entry && entry.votes >= 0 && !entry.original;

// Locked first, then votes. Ties keep the earlier entry, which is the order the server sent.
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
        // A thumbnail with no timestamp names no frame, so it is nothing to show.
        timestamp: thumbnail && typeof thumbnail.timestamp === 'number' ? thumbnail.timestamp : null
    };
};

const brandingFor = (videoID) => fetch(`${API}?videoID=${videoID}`)
    .then((res) => res.json())
    .then(bestOf);

const thumbnailUrl = (videoID, timestamp) =>
    `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoID}&time=${timestamp}`;

export { brandingFor, bestOf, thumbnailUrl };
