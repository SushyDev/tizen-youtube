import { configRead, configWrite } from '../config.js';
import { findResolver, resolve } from './internals.js';
import { openOptions, OPTIONS_ACTION } from '../ui/settingsOptions.js';
import { openSpeedOptions } from '../ui/speedUI.js';
import { showToast, buttonItem } from '../ui/ytUI.js';
import { enterMiniPlayer } from '../features/pictureInPicture.js';
import { chooseQuality, chooseAudioTrack, noteSpeed, startsAt } from '../features/nativePlayback.js';

const PASS = { pass: true };

const APP_NAME = 'YouTube';

const ACTIONS = {
    [OPTIONS_ACTION]: (parameters) => openOptions(parameters),

    OPEN_SPEED_OPTIONS: () => openSpeedOptions(),

    // The keypress is what dismisses the overlay: the panel has no command for it.
    SKIP: (parameters) => {
        const escape = document.createEvent('Event');
        escape.initEvent('keydown', true, true);
        escape.keyCode = 27;
        escape.which = 27;
        document.dispatchEvent(escape);

        const video = document.querySelector('video');
        if (video) video.currentTime = parameters.time;
    },

    SET_PLAYER_SPEED: (parameters) => {
        const video = document.querySelector('video');
        if (video) video.playbackRate = Number(parameters);

        // The set plays our own stream silently at anything but normal speed, so the choice
        // decides which pipeline the video has to be on.
        noteSpeed(Number(parameters));
    },

    ENTER_MP: () => enterMiniPlayer(),

    SHOW_TOAST: (parameters) => showToast(APP_NAME, parameters),

    ADD_TO_QUEUE: (parameters) => {
        window.queuedVideos.videos.push(parameters);
        showToast(APP_NAME, 'Added to queue');
    },

    CLEAR_QUEUE: () => {
        window.queuedVideos.videos = [];
        showToast(APP_NAME, 'Queue cleared');
    }
};

// A custom action can be nested under any of these, because YouTube's renderers each
// expect their own shape.
const CARRIERS = ['customAction', 'signalAction', 'showEngagementPanelEndpoint', 'playlistEditEndpoint'];

const customActionIn = (command) => {
    if (!command) return null;
    if (command.customAction) return command.customAction;

    const carrier = CARRIERS.find((key) => command[key] && command[key].customAction);
    return carrier ? command[carrier].customAction : null;
};

const perform = (action) => {
    const run = ACTIONS[action.action];
    if (run) run(action.parameters);
    return !!run;
};

// YouTube's own settings all have underscored enum names; ours are the config keys.
const applyOurSettings = (command) => {
    const endpoint = command.setClientSettingEndpoint;
    if (!endpoint || !endpoint.settingDatas) return PASS;

    const language = endpoint.settingDatas.find((setting) =>
        setting.clientSettingEnum && setting.clientSettingEnum.item === 'I18N_LANGUAGE');

    if (language) {
        // YouTube reads the interface language from a cookie, not a field.
        const expires = new Date();
        expires.setFullYear(expires.getFullYear() + 10);
        document.cookie = `PREF=hl=${language.stringValue}; expires=${expires.toUTCString()};`;

        resolve({ signalAction: { signal: 'RELOAD_PAGE' } });
        return true;
    }

    const ours = endpoint.settingDatas.filter((setting) =>
        setting.clientSettingEnum && setting.clientSettingEnum.item.indexOf('_') === -1);

    if (ours.length === 0) return PASS;

    ours.forEach((setting) => {
        const key = setting.clientSettingEnum.item;
        const field = Object.keys(setting).find((name) => name.indexOf('Value') !== -1);
        const value = field === 'intValue' ? Number(setting[field]) : setting[field];

        if (field !== 'arrayValue') return configWrite(key, value);

        // A new array, so configWrite never gets the stored one back.
        const current = configRead(key) || [];
        configWrite(key, current.indexOf(value) === -1
            ? current.concat(value)
            : current.filter((entry) => entry !== value));
    });

    return true;
};

const runCustomActions = (command) => {
    const action = customActionIn(command);
    return action && perform(action) ? true : PASS;
};

const dressPlaybackSettings = (command) => {
    const popup = command.openPopupAction;
    if (!popup || popup.uniqueId !== 'playback-settings') return PASS;

    const list = popup.popup
        && popup.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer
            .actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer;

    if (!list || !list.items) return PASS;

    list.items.forEach((item) => {
        const link = item.compactLinkRenderer;
        if (!link || !link.icon || link.icon.iconType !== 'SLOW_MOTION_VIDEO') return;

        if (link.subtitle) link.subtitle.simpleText = 'More speeds';

        link.serviceEndpoint = {
            clickTrackingParams: 'null',
            signalAction: { customAction: { action: 'OPEN_SPEED_OPTIONS', parameters: [] } }
        };
    });

    const hasMiniPlayer = list.items.some((item) =>
        item.compactLinkRenderer
        && item.compactLinkRenderer.serviceEndpoint
        && JSON.stringify(item.compactLinkRenderer.serviceEndpoint).indexOf('ENTER_MP') !== -1);

    if (!hasMiniPlayer) {
        list.items.splice(2, 0, buttonItem(
            { title: 'Mini Player' },
            { icon: 'CLEAR_COOKIES' },
            [{ customAction: { action: 'ENTER_MP' } }]
        ));
    }

    // Edited, not answered: YouTube still has to open the panel.
    return PASS;
};

const forgetMiniPlayer = (command) => {
    if (!command.watchEndpoint || !command.watchEndpoint.videoId) return PASS;

    window.isPipPlaying = false;

    const container = document.querySelector('ytlr-player-container');
    if (container) container.style.removeProperty('z-index');

    return PASS;
};

const runCommandBatch = (command) => {
    const batch = command.commandExecutorCommand && command.commandExecutorCommand.commands;
    if (!batch) return PASS;

    batch.forEach((entry) => {
        const action = customActionIn(entry);
        if (action) perform(action);
        else resolve(entry);
    });

    return true;
};

const skipWhosWatchingOnExit = (command, original, self, context) => {
    const request = command.requestAccountSelectorCommand;

    const onExit = request
        && request.identityActionContext
        && request.identityActionContext.eventTrigger === 'ACCOUNT_EVENT_TRIGGER_ON_EXIT';

    if (!onExit || configRead('enableWhosWatchingMenuOnAppExit')) return PASS;

    original.call(self, { signalAction: { signal: 'EXIT_APP' } }, context);
    return false;
};

// The account carousel a signed-in set is shown arrives as a command rather than through
// the "last fired" record, and arrived on every launch regardless of the setting.
// Answering it takes a remote, so an app left to start on its own got no further.
//
// These are the triggers that mean "before anything has been asked for", as against a
// locked account, a PIN or an upgrade, where a real answer is needed.
const ON_ARRIVAL = [
    'ACCOUNT_EVENT_TRIGGER_WHOS_WATCHING',
    'ACCOUNT_EVENT_TRIGGER_WHO_FALLBACK',
    'ACCOUNT_EVENT_TRIGGER_APP_WELCOME',
    'ACCOUNT_EVENT_TRIGGER_WELCOME_BACK'
];

const skipWhosWatchingOnArrival = (command) => {
    const request = command.requestAccountSelectorCommand;

    const trigger = request
        && request.identityActionContext
        && request.identityActionContext.eventTrigger;

    if (!trigger || ON_ARRIVAL.indexOf(trigger) === -1) return PASS;
    if (configRead('enableWhoIsWatchingMenu') || configRead('permanentlyEnableWhoIsWatchingMenu')) return PASS;

    return false;
};

const noteViewerChoice = (command) => {
    const batch = command.commandExecutorCommand;
    if (!batch || !Array.isArray(batch.commands)) return PASS;

    const closes = batch.commands.some((one) =>
        one.signalAction && one.signalAction.signal === 'POPUP_BACK');

    if (!closes) return PASS;

    batch.commands.forEach((one) => {
        const settings = one.setClientSettingEndpoint;
        if (!settings || !Array.isArray(settings.settingDatas)) return;

        settings.settingDatas.forEach((setting) => {
            const item = (setting.clientSettingEnum || {}).item;

            if (item === 'PLAYBACK_QUALITY' && typeof setting.stringValue === 'string') {
                try {
                    const { quality } = JSON.parse(setting.stringValue);
                    if (quality) chooseQuality(quality);
                } catch (e) {
                    // A shape this does not recognise is not a reason to swallow the command.
                }
                return;
            }

            // Any other playback setting: the audio track, stable volume, voice boost. Telling them
            // apart by name would mean guessing at names, and asking what changed answers all of them.
            if (typeof item === 'string' && item.indexOf('PLAYBACK_') === 0) chooseAudioTrack();
        });
    });

    return PASS;
};

// Knowing where a part-watched video resumes before the element is given an address is
// what stops the opening seconds playing before the seek lands.
const noteStartTime = (command) => {
    const watch = command.watchEndpoint;
    if (watch && watch.videoId) startsAt(watch.videoId, Number(watch.startTimeSeconds) || 0);

    return PASS;
};

const INTERPRETERS = [
    noteViewerChoice,
    noteStartTime,
    applyOurSettings,
    runCustomActions,
    dressPlaybackSettings,
    forgetMiniPlayer,
    runCommandBatch,
    skipWhosWatchingOnExit,
    skipWhosWatchingOnArrival
];

const interceptCommands = () => {
    const resolver = findResolver();
    if (!resolver || resolver.__tubePatched) return false;

    const original = resolver.resolveCommand;

    resolver.resolveCommand = function (command, context) {
        if (!command) return original.call(this, command, context);

        for (let index = 0; index < INTERPRETERS.length; index++) {
            let answer;

            try {
                answer = INTERPRETERS[index](command, original, this, context);
            } catch (failure) {
                console.error('A command interpreter failed:', failure);
                answer = PASS;
            }

            if (answer !== PASS) return answer;
        }

        return original.call(this, command, context);
    };

    resolver.__tubePatched = true;
    return true;
};

export { interceptCommands, APP_NAME };
