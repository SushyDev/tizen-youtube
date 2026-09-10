import { GRID, PIVOT, SHELF, TILES, configRead, keepTile } from '../../framework/index.js';

// Videos already finished, dropped from the shelves on the pages the viewer chose.

const pageName = () => {
    const hash = location.hash.substring(1);
    if (hash === '/') return 'home';
    if (hash.startsWith('/search')) return 'search';

    return hash.split('?')[1]?.split('&')[0]?.split('=')[1]?.replace('FE', '')?.replace('topics_', '') ?? '';
};

keepTile('watched', [SHELF, PIVOT, TILES, GRID], (item) => {
    if (!item.tileRenderer) return true;

    const progress = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays
        ?.find((overlay) => overlay.thumbnailOverlayResumePlaybackRenderer)
        ?.thumbnailOverlayResumePlaybackRenderer;

    if (!progress) return true;
    if (!configRead('enableHideWatchedVideos')) return true;

    const pages = configRead('hideWatchedVideosPages');
    if (!pages.length) return true;

    // Read per tile rather than per response: the hash can move under a walk.
    if (!pages.includes(pageName())) return true;

    return (progress.percentDurationWatched || 0) <= configRead('hideWatchedVideosThreshold');
});
