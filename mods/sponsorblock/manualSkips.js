import { configRead, onResponse, timelyAction } from '../../framework/index.js';
import { nameOf } from './segments.js';
import { segmentsForVideo } from './index.js';
import { skipTo } from './skipTo.js';

const cardFor = (segment) => timelyAction(
    `Skip ${nameOf(segment)}`,
    'SKIP_NEXT',
    skipTo(segment.segment[1]),
    segment.segment[0] * 1000,
    segment.segment[1] * 1000 - segment.segment[0] * 1000
);

onResponse('sponsorblock overlay', ['playerOverlays'], (response) => {
    const overlay = response.playerOverlays && response.playerOverlays.playerOverlayRenderer;
    if (!overlay) return;

    const byHand = configRead('sponsorBlockManualSkips');
    if (!byHand.length) return;

    const segments = segmentsForVideo();
    if (!segments.length) return;

    overlay.timelyActionRenderers = (overlay.timelyActionRenderers || []).concat(
        segments.filter((segment) => byHand.indexOf(segment.category) !== -1).map(cardFor)
    );
});
