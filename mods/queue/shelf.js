import { PIVOT, ShelfRenderer, TileRenderer, onSurface } from '../../framework/index.js';
import { say } from '../i18n/index.js';

const queued = () => (window.queuedVideos && window.queuedVideos.videos) || [];

const openAt = (rows) =>
    Math.max(rows.findIndex((v) => v.tileRenderer?.contentId === window.queuedVideos.lastVideoId), 0);

onSurface('queue shelf', [PIVOT], (rows) => {
    if (!queued().length) return;

    const videos = [TileRenderer(say('Clear Queue'), { customAction: { action: 'CLEAR_QUEUE' } })]
        .concat(queued());

    rows.unshift(ShelfRenderer(say('Queued Videos'), videos, openAt(videos)));
});
