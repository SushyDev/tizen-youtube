import { configRead, onResponse } from '../../framework/index.js';

// What YouTube lays over the picture while a video plays.
//
// These arrive as timelyActionRenderers — a list of cards, each with a type and a time to appear
// at. The shopping one sells merchandise behind a QR code; the NFL watermark is a badge nobody
// asked for and there has never been a setting for it.

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
