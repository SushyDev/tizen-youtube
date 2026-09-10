import { configRead, onResponse, timelyAction } from '../../framework/index.js';
import { SEGMENTS } from './segments.js';
import { segmentsForVideo } from './sponsorblock.js';
import { skipTo } from './skipTo.js';

// A card offering to skip each segment the viewer chose to skip by hand rather than
// automatically, shown over the picture for as long as the segment lasts.

const cardFor = (segment) => timelyAction(
    `Skip ${SEGMENTS[segment.category]?.name || segment.category}`,
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
