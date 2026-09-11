import { GRID, PIVOT, SHELF, TILES, configRead, onTile } from '../../framework/index.js';
import { brandingFor, thumbnailUrl } from './brandingApi.js';
import { brandingOf, remember } from './brandingStore.js';

// DeArrow titles and thumbnails, dressed only from the store; a miss asks the API for next time.

// In flight right now, so a video carried by six shelves is asked about once.
const asking = Object.create(null);

const ask = (videoID) => {
    if (asking[videoID]) return;
    asking[videoID] = true;

    brandingFor(videoID)
        .then((best) => remember(videoID, best))
        // A failure is not remembered, since the store keeps what it is given across launches.
        .catch(() => undefined)
        .then(() => {
            delete asking[videoID];
        });
};

const dressTitle = (item, title) => {
    if (!title) return;

    const holder = item.tileRenderer.metadata?.tileMetadataRenderer?.title;
    if (holder) holder.simpleText = title;
};

const dressThumbnail = (item, videoID, timestamp) => {
    if (timestamp === null) return;
    if (!configRead('enableDeArrowThumbnails')) return;

    const holder = item.tileRenderer.header?.tileHeaderRenderer?.thumbnail;
    if (!holder) return;

    holder.thumbnails = [{ url: thumbnailUrl(videoID, timestamp), width: 1280, height: 640 }];
};

const deArrowify = (item) => {
    if (!item.tileRenderer) return;
    if (!configRead('enableDeArrow')) return;

    const videoID = item.tileRenderer.contentId;
    if (!videoID) return;

    const known = brandingOf(videoID);

    // Never asked about. Nothing can be dressed now; the answer lands in the store and the next
    // response carrying this video uses it.
    if (known === undefined) return ask(videoID);

    // Asked about, and DeArrow had nothing to say.
    if (known === null) return;

    dressTitle(item, known.title);
    dressThumbnail(item, videoID, known.timestamp);
};

onTile('deArrow', [SHELF, PIVOT, TILES, GRID], deArrowify);
