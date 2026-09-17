import { configRead, onResponse } from '../../framework/index.js';

const UP_NEXT = 'TIMELY_ACTION_TYPE_UP_NEXT';

const wanted = () => configRead('enableUpNextCard');

onResponse('up next', ['playerOverlays', 'contents'], (response) => {
    if (wanted()) return;

    const overlay = response.playerOverlays && response.playerOverlays.playerOverlayRenderer;

    if (overlay) {
        if (Array.isArray(overlay.timelyActionRenderers)) {
            overlay.timelyActionRenderers = overlay.timelyActionRenderers.filter((action) =>
                !action.timelyActionRenderer || action.timelyActionRenderer.type !== UP_NEXT);
        }

        // The card is the only countdown, so without this the next video starts unannounced.
        overlay.isAutoplayEnabled = false;
    }

    const watchNext = response.contents && response.contents.singleColumnWatchNextResults;
    const sets = watchNext && watchNext.autoplay && watchNext.autoplay.autoplay;

    // Emptied rather than removed: the player reads through this shape.
    if (sets && Array.isArray(sets.sets)) sets.sets = [];
});
