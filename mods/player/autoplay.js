import { configRead, onResponse } from '../../framework/index.js';

// Hiding the Up next card also disables autoplay, since the card is the only warning.

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

        // The card is only the announcement. Without this the countdown is invisible and the next
        // video starts anyway, which is worse than leaving it alone.
        overlay.isAutoplayEnabled = false;
    }

    const watchNext = response.contents && response.contents.singleColumnWatchNextResults;
    const sets = watchNext && watchNext.autoplay && watchNext.autoplay.autoplay;

    // Emptied rather than removed: the player reads through this shape, and taking it away
    // entirely is a bigger change to the response than saying there is nothing queued.
    if (sets && Array.isArray(sets.sets)) sets.sets = [];
});
