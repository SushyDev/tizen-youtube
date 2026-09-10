import { ButtonRenderer, configRead, onResponse } from '../../framework/index.js';

// The buttons around the video, dressed in the response.
//
// What this replaces reached the same buttons by scanning YouTube's module registry for a class,
// swapping the registry slot for a look-alike constructor, and stacking four wrappers on one of
// its methods. It was found doing nothing at all: nothing it defines existed anywhere in the
// 3116 modules, though the class it hunts was loaded and the setting was on. One unguarded
// `toString()` on a module that is still initialising throws, and its retry chain ends there —
// permanently, and silently.
//
// None of that is necessary. `transportControlsRenderer` carries every group it wanted:
//
//   skipPreviousButton  skipNextButton  promotedActions  engagementActions  settingActions
//
// so this is an ordinary reader, guarded and ordered like every other, and it cannot be killed by
// a module that was not ready. Read off the set, those groups hold:
//
//   engagementActions  LIKE_BUTTON COMMENTS ADD_TO_PLAYLIST
//   settingActions     CAPTIONS PLAYBACK_SETTINGS QUALITY SURROUND_SOUND REPORT_VIDEO FEEDBACK
//                      STATS_FOR_NERDS SPEED_BUTTON LOOP_BUTTON AUDIO_TRACKS DRC
//   promotedActions    CHANNEL_BUTTON ABOUT_BUTTON SUBSCRIBE
//
// SPEED_BUTTON is in that list, which is why there is no speed button here: the container ships
// one, and adding a second is the mistake the duplicate previews switch already made.

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

const dressEngagement = (actions) => {
    const kept = [
        !configRead('enableSuperThanksButton') ? 'SUPER_THANKS' : null,
        configRead('hideShoppingAction') ? 'SHOPPING' : null,
        !configRead('enableAIAskButton') ? 'YOUCHAT_BUTTON' : null
    ].filter(Boolean).reduce(without, actions);

    return kept;
};

const dressSettings = (actions) => (configRead('enableMPButton') ? withMiniPlayer(actions) : actions);

// Replaced wholesale rather than dressed: YouTube's own pair are chapter controls on some videos,
// and what this asks for is the previous and next video in the queue. Wrapped, because in the
// response these are a renderer envelope rather than the bare renderer the old code returned
// from a getter.
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
