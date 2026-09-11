import { configRead, onResponse } from '../../framework/index.js';

// Drops the NFL watermark, and the shopping card if hideShoppingAction, from the player overlay.

const NFL_WATERMARK = 'TIMELY_ACTION_TYPE_NFL_WATERMARK';
const SHOPPING = 'TIMELY_ACTION_TYPE_SHOPPING';

const unwanted = () => (configRead('hideShoppingAction')
    ? [SHOPPING, NFL_WATERMARK]
    : [NFL_WATERMARK]);

onResponse('player overlays', ['playerOverlays'], (response) => {
    const overlay = response.playerOverlays && response.playerOverlays.playerOverlayRenderer;
    if (!overlay) return;

    const dropped = unwanted();

    overlay.timelyActionRenderers = (overlay.timelyActionRenderers || [])
        .filter((action) => dropped.indexOf(action?.timelyActionRenderer?.type) === -1);
});
