import { configChangeEmitter, configRead, every, stop } from '../../framework/index.js';
import { thumbnailUrl } from '../feed/brandingApi.js';
import { brandingOf } from '../feed/brandingStore.js';

// A tile can render before DeArrow's answer arrives, so this sweeps the screen to catch it up.
const TILE = 'ytlr-tile-renderer';
const THUMBNAIL = 'ytlr-thumbnail-details';
const TITLE = 'ytlr-tile-metadata-renderer yt-formatted-string';
const MARK = 'data-tube-dearrow-for';
const NAME = 'dearrow live';
const INTERVAL = 1000;

// The video id isn't on the element; it's read back out of the thumbnail's own URL.
const videoIdOf = (tile) => {
    const thumb = tile.querySelector(THUMBNAIL);
    if (!thumb) return null;

    const image = thumb.style.backgroundImage;
    const match = /\/vi\/([a-zA-Z0-9_-]{11})\//.exec(image) || /videoID=([a-zA-Z0-9_-]{11})/.exec(image);
    return match ? match[1] : null;
};

// Marked by video id, not a flag — virtualized reuse would leave a stale flag on a new video.
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
