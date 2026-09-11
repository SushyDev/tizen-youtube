import { PIVOT, ShelfRenderer, TileRenderer, onSurface } from '../../framework/index.js';

// The queue, as a shelf at the top of the watch-next pivot.

const queued = () => (window.queuedVideos && window.queuedVideos.videos) || [];

const openAt = (rows) =>
    Math.max(rows.findIndex((v) => v.tileRenderer?.contentId === window.queuedVideos.lastVideoId), 0);

onSurface('queue shelf', [PIVOT], (rows) => {
    if (!queued().length) return;

    const videos = [TileRenderer('Clear Queue', { customAction: { action: 'CLEAR_QUEUE' } })]
        .concat(queued());

    rows.unshift(ShelfRenderer('Queued Videos', videos, openAt(videos)));
});
