import { GRID, PIVOT, SHELF, TILES, configRead, keepShelf, keepTile, onRequest, onResponse } from '../../framework/index.js';

// Adverts, and nothing else.
//
// This file used to hold fifteen features because it was the one place with a tileRenderer in
// hand. The walk gave everything else a way in, so what is left is the thing it is named after.
//
// Adverts arrive in five shapes: before a video, inside the player's own list, as a slot in a
// browse section, as a slot among the tiles of a shelf, and as a reel marked isAd. All five are
// answered here, and all five follow the setting — which they did not, and the one that mattered
// least was the only one that did.

const blocking = () => configRead('enableAdBlock');

onResponse('adverts', ['adPlacements', 'adSlots', 'playerAds', 'entries'], (r) => {
    if (!blocking()) return;

    if (r.adPlacements) r.adPlacements = [];
    if (r.playerAds) r.playerAds = false;
    if (r.adSlots) r.adSlots = [];

    if (!Array.isArray(r) && r?.entries) {
        r.entries = r.entries.filter((entry) => !entry?.command?.reelWatchEndpoint?.adClientParams?.isAd);
    }
});

// An advert occupying a whole row of the feed. This used to descend to the browse surface by hand,
// which is why pressing Refresh brought adverts back: the refreshed feed arrives under a different
// name and only the walk knows all of them.
keepShelf('advert sections', [SHELF, PIVOT], (shelf) => !shelf.adSlotRenderer || !blocking());

// An advert slot sitting among the tiles of a shelf. A keeper rather than a splice, because
// splicing during a walk skips whatever followed each removal — two adjacent adverts used to
// leave the second one on screen.
keepTile('advert slots', [SHELF, PIVOT, TILES, GRID],
    (item) => !item.adSlotRenderer || !blocking());

// Claiming an inline playback carries no advert suppresses them upstream, before any response
// exists — so this, not the filtering above, is what actually keeps adverts off the set. It ran
// unconditionally, which made the setting a lie: switching adverts back on left this in place and
// nothing changed.
onRequest('playback context', ['playbackContext'], (value) => {
    if (!blocking()) return value;

    const context = value.playbackContext && value.playbackContext.contentPlaybackContext;
    if (!context || context.isInlinePlaybackNoAd) return value;

    return Object.assign({}, value, {
        playbackContext: Object.assign({}, value.playbackContext, {
            contentPlaybackContext: Object.assign({}, context, { isInlinePlaybackNoAd: true })
        })
    });
});
