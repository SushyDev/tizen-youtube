import { GRID, PIVOT, SHELF, TILES, configRead, onTile } from '../../framework/index.js';

// Thumbnails at the size a television wants. YouTube offers this client the one sized for a
// phone; sddefault is the same image, larger, and the query it was signed with still applies.

// Only i.ytimg.com URLs are enlarged, so a DeArrow thumbnail set earlier survives.
const YOUTUBE_THUMBNAIL = /^https?:\/\/i\.ytimg\.com\//;

const hqify = (item) => {
    if (!item.tileRenderer) return;
    if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') return;
    if (!configRead('enableHqThumbnails')) return;
    if (!item.tileRenderer.onSelectCommand?.watchEndpoint?.videoId) return;
    if (!item.tileRenderer.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.[0]?.url) return;

    const current = item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0].url;
    if (!YOUTUBE_THUMBNAIL.test(current)) return;

    const videoID = item.tileRenderer.onSelectCommand.watchEndpoint.videoId;
    const queryArgs = current.split('?')[1];
    item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [
        {
            url: `https://i.ytimg.com/vi/${videoID}/sddefault.jpg${queryArgs ? `?${queryArgs}` : ''}`,
            width: 640,
            height: 480
        }
    ];
};

onTile('hq thumbnails', [SHELF, PIVOT, TILES, GRID], hqify);
