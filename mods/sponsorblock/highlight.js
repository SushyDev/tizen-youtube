import { ButtonRenderer, configRead, onResponse } from '../../framework/index.js';
import { segmentsForVideo } from './index.js';
import { skipTo } from './skipTo.js';
import { say } from '../i18n/index.js';

onResponse('sponsorblock highlight', ['transportControls'], (response) => {
    if (!configRead('enableSponsorBlockHighlight')) return;

    const controls = response.transportControls && response.transportControls.transportControlsRenderer;
    if (!controls || !controls.promotedActions) return;

    const highlight = segmentsForVideo().find((segment) => segment.category === 'poi_highlight');
    if (!highlight) return;

    controls.promotedActions.push({
        type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPONSORBLOCK_HIGHLIGHT',
        button: {
            buttonRenderer: ButtonRenderer(false, say('Skip to highlight'), 'SKIP_NEXT', skipTo(highlight.segment[0]))
        }
    });
});
