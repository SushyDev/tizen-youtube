import { configRead } from '../../framework/index.js';
import { videoIdIn } from '../sponsorblock/index.js';
import { fetchCount } from './api.js';
import { dislikesOf, remember } from './store.js';

// transportControls never reaches interception on this engine, so the video id comes from the URL hash instead.

// In flight now, so a video whose hash is seen more than once is asked about only once.
const asking = Object.create(null);

const ask = (videoID) => {
    if (asking[videoID]) return;
    asking[videoID] = true;

    fetchCount(videoID)
        .then((dislikes) => {
            if (dislikes !== null) remember(videoID, dislikes);
        })
        .catch(() => undefined)
        .then(() => {
            delete asking[videoID];
        });
};

const checkVideo = (hash) => {
    if (!configRead('enableReturnDislike')) return;

    const videoID = videoIdIn(hash);
    if (!videoID) return;

    // Skipped once a count is already known, so a fresh one is only ever fetched once.
    if (dislikesOf(videoID) === undefined) ask(videoID);
};

window.addEventListener('hashchange', () => checkVideo(location.hash), false);

// The first video of a session arrives with no hashchange of its own.
checkVideo(location.hash);

export { checkVideo };
