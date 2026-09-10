import { GRID, PIVOT, SHELF, TILES, configRead, onTile } from '../../framework/index.js';
import { brandingFor, thumbnailUrl } from './brandingApi.js';
import { brandingOf, remember } from './brandingStore.js';

// DeArrow: community titles and thumbnails in place of the ones chosen to be clicked on.
//
// The only visitor that needs the network, and the one the walk cannot wait for. A tile is dressed
// inside JSON.parse, synchronously, before the object goes back to the app — so an answer still in
// flight is an answer that cannot be applied. This used to try anyway, dressing the tile from a
// `.then()` after the app had already taken the title, which is why nothing changed on a fresh
// launch and it appeared to work only when the same video came round twice in one session.
//
// So a request dresses nothing. A request fills the store, and the store is what dresses. Which
// answer to believe is brandingApi.js; keeping it across launches is brandingStore.js.

// In flight right now, so a video carried by six shelves is asked about once.
const asking = Object.create(null);

const ask = (videoID) => {
  if (asking[videoID]) return;
  asking[videoID] = true;

  brandingFor(videoID)
    // Remembered as nothing, so a video the service will not answer for is not asked about again
    // on every scroll.
    .catch(() => null)
    .then((best) => {
      remember(videoID, best);
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
