import { ButtonRenderer, configRead, onResponse } from '../../framework/index.js';
import { segmentsForVideo } from './sponsorblock.js';
import { skipTo } from './skipTo.js';

// A button in the player's promoted row that jumps straight to the part of the video everyone
// came for, when SponsorBlock's contributors have marked one.

onResponse('sponsorblock highlight', ['transportControls'], (response) => {
    if (!configRead('enableSponsorBlockHighlight')) return;

    const controls = response.transportControls && response.transportControls.transportControlsRenderer;
    if (!controls || !controls.promotedActions) return;

    const highlight = segmentsForVideo().find((segment) => segment.category === 'poi_highlight');
    if (!highlight) return;

    controls.promotedActions.push({
        type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPONSORBLOCK_HIGHLIGHT',
        button: {
            buttonRenderer: ButtonRenderer(false, 'Skip to highlight', 'SKIP_NEXT', skipTo(highlight.segment[0]))
        }
    });
});
