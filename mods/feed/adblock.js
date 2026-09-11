import { GRID, PIVOT, SHELF, TILES, configRead, keepShelf, keepTile, onRequest, onResponse } from '../../framework/index.js';

// Advert suppression, gated by enableAdBlock.

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

keepShelf('advert sections', [SHELF, PIVOT], (shelf) => !shelf.adSlotRenderer || !blocking());

keepTile('advert slots', [SHELF, PIVOT, TILES, GRID],
    (item) => !item.adSlotRenderer || !blocking());

// Claiming no-ad playback suppresses adverts upstream, before any response exists.
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
