import { PIVOT, ShelfRenderer, TileRenderer, onSurface } from '../../framework/index.js';

// The queue, shown as its own shelf under the video. It lived in adblock.js and reached into
// window.queuedVideos from there; it sits beside the queue it belongs to now.
//
// Added through the walk rather than by naming the pivot's path: the path is surfaces.js's to
// know, and a feature that spells one out itself only works on the surfaces it thought of.

const queued = () => (window.queuedVideos && window.queuedVideos.videos) || [];

const openAt = (rows) =>
    Math.max(rows.findIndex((v) => v.tileRenderer?.contentId === window.queuedVideos.lastVideoId), 0);

onSurface('queue shelf', [PIVOT], (rows) => {
    if (!queued().length) return;

    const videos = [TileRenderer('Clear Queue', { customAction: { action: 'CLEAR_QUEUE' } })]
        .concat(queued());

    rows.unshift(ShelfRenderer('Queued Videos', videos, openAt(videos)));
});
