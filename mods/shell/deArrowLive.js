import { configChangeEmitter, configRead, every, stop } from '../../framework/index.js';
import { thumbnailUrl } from '../feed/brandingApi.js';
import { brandingOf } from '../feed/brandingStore.js';

// A tile is dressed synchronously inside JSON.parse, before DeArrow's answer can possibly have
// arrived (brandingStore.js), and nothing re-parses an already-rendered response afterwards — a
// page landed on once (a channel's video list, say) never gets a second pass to pick the answer
// up. This sweeps the tiles currently on screen and catches each one up once its answer lands.
const TILE = 'ytlr-tile-renderer';
const THUMBNAIL = 'ytlr-thumbnail-details';
const TITLE = 'ytlr-tile-metadata-renderer yt-formatted-string';
const MARK = 'data-tube-dearrow-for';
const NAME = 'dearrow live';
const INTERVAL = 1000;

// The video id is not carried on the element anywhere; the thumbnail's own URL is read back out
// of it instead, the same way YouTube put it there.
const videoIdOf = (tile) => {
    const thumb = tile.querySelector(THUMBNAIL);
    if (!thumb) return null;

    const image = thumb.style.backgroundImage;
    const match = /\/vi\/([a-zA-Z0-9_-]{11})\//.exec(image) || /videoID=([a-zA-Z0-9_-]{11})/.exec(image);
    return match ? match[1] : null;
};

// Marked by video id, not a plain flag — the list is virtualized, so the same element is reused
// for a different video as the viewer scrolls, and a stale flag would leave that video undressed.
const catchUp = (tile) => {
    const videoID = videoIdOf(tile);
    if (!videoID || tile.getAttribute(MARK) === videoID) return;

    const known = brandingOf(videoID);
    if (known === undefined) return;

    tile.setAttribute(MARK, videoID);
    if (known === null) return;

    if (known.title) {
        const title = tile.querySelector(TITLE);
        if (title) title.textContent = known.title;
    }

    if (known.timestamp !== null && configRead('enableDeArrowThumbnails')) {
        const thumb = tile.querySelector(THUMBNAIL);
        if (thumb) thumb.style.setProperty('background-image', `url(${thumbnailUrl(videoID, known.timestamp)})`, 'important');
    }
};

// NodeList has no forEach on this engine, so results are read through Array.from.
const sweep = () => Array.from(document.querySelectorAll(TILE)).forEach(catchUp);

const sync = () => {
    if (configRead('enableDeArrow')) every(NAME, INTERVAL, sweep);
    else stop(NAME);
};

sync();

configChangeEmitter.addEventListener('configChange', (event) => {
    if (event.detail.key === 'enableDeArrow' || event.detail.key === 'enableDeArrowThumbnails') sync();
});
