import { ButtonRenderer, configRead, onResponse } from '../../framework/index.js';

// Transport-control buttons, dressed in the response; the container already ships a speed button.

const type = (entry) => String((entry && entry.type) || '');

const is = (name) => (entry) => type(entry) === `TRANSPORT_CONTROLS_BUTTON_TYPE_${name}`;

const without = (actions, name) => actions.filter((entry) => !is(name)(entry));

// The mini player is genuinely absent — there is no PIP button in settingActions on this build —
// so this one adds rather than removes.
const miniPlayer = () => ({
    type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_PIP',
    button: {
        buttonRenderer: ButtonRenderer(false, 'Mini Player', 'CLEAR_COOKIES', {
            customAction: { action: 'ENTER_MP' }
        })
    }
});

const withMiniPlayer = (actions) => {
    if (actions.some(is('PIP'))) return actions;

    const at = actions.findIndex(is('PLAYBACK_SETTINGS'));
    if (at === -1) return actions.concat([miniPlayer()]);

    return actions.slice(0, at).concat([miniPlayer()], actions.slice(at));
};

const dressEngagement = (actions) => [
    !configRead('enableSuperThanksButton') ? 'SUPER_THANKS' : null,
    configRead('hideShoppingAction') ? 'SHOPPING' : null,
    !configRead('enableAIAskButton') ? 'YOUCHAT_BUTTON' : null
].filter(Boolean).reduce(without, actions);

const dressSettings = (actions) => (configRead('enableMPButton') ? withMiniPlayer(actions) : actions);

// Replaced, not dressed: YouTube's pair are chapter controls, ours step through the queue.
const skipButton = (title, icon, signal) => ({
    buttonRenderer: ButtonRenderer(false, title, icon, { signalAction: { signal } })
});

onResponse('player buttons', ['transportControls'], (response) => {
    const controls = response.transportControls && response.transportControls.transportControlsRenderer;
    if (!controls) return;

    if (Array.isArray(controls.engagementActions)) {
        controls.engagementActions = dressEngagement(controls.engagementActions);
    }

    if (Array.isArray(controls.settingActions)) {
        controls.settingActions = dressSettings(controls.settingActions);
    }

    if (!configRead('enablePreviousNextButtons')) return;

    if (controls.skipPreviousButton) {
        controls.skipPreviousButton = skipButton('Previous', 'SKIP_PREVIOUS', 'PLAYER_PLAY_PREVIOUS');
    }

    if (controls.skipNextButton) {
        controls.skipNextButton = skipButton('Next', 'SKIP_NEXT', 'PLAYER_PLAY_NEXT');
    }
});
