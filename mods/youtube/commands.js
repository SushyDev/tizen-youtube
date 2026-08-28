import { configRead, configWrite } from '../config.js';
import { findResolver, resolve } from './internals.js';
import { openAdditionalOptions, openOptionsSubmenu } from '../ui/settings.js';
import { openSpeedOptions } from '../ui/speedUI.js';
import { showToast, buttonItem } from '../ui/ytUI.js';
import { enterMiniPlayer } from '../features/pictureInPicture.js';

// Every command the interface issues, and the ones this app answers itself.
//
// YouTube routes all of it — opening a panel, changing a setting, navigating,
// playing a video — through a single `resolveCommand` on one singleton. That
// makes it both the way to drive the app from here and the one place to sit
// and listen. Wrapping it is how this app's own settings end up looking and
// behaving exactly like YouTube's: they are not a separate interface bolted on
// top, they are commands, resolved by the same function as everything else.
//
// The wrapper reads as a list of interpreters, each asked in turn whether a
// command is theirs. An interpreter either answers with the result, or hands
// the command on untouched. That shape replaces a single ninety-line
// `if/else if` chain in which several branches were already unreachable.

// What an interpreter returns when the command is not its business.
const PASS = { pass: true };

// The name every notification raised from here appears under. There is one app
// on the television as far as anyone using it is concerned, and it is YouTube.
const APP_NAME = 'YouTube';

// ── The actions this app defines ──────────────────────────────────────

// Commands YouTube has never heard of, carried inside its own command objects
// under `customAction` so they travel the same rails as everything else.
const ACTIONS = {
    OPEN_ADDITIONAL_OPTIONS: () => openAdditionalOptions(),

    OPEN_SPEED_OPTIONS: () => openSpeedOptions(),

    SETTINGS_UPDATE: (parameters) => openAdditionalOptions(true, parameters),

    OPTIONS_SHOW: (parameters) => openOptionsSubmenu(parameters, parameters.update),

    // Dismisses the overlay, then seeks. The keypress is what closes it: the
    // panel has no command of its own that means "go away".
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

// A custom action can be nested under any of several endpoints, because
// YouTube's renderers each expect their own shape. This is the only place
// that has to know all of them.
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

// ── The interpreters ──────────────────────────────────────────────────

// A setting YouTube does not recognise is one of ours. Its own settings all
// have underscored enum names; ours are the config keys themselves.
const applyOurSettings = (command) => {
    const endpoint = command.setClientSettingEndpoint;
    if (!endpoint || !endpoint.settingDatas) return PASS;

    const language = endpoint.settingDatas.find((setting) =>
        setting.clientSettingEnum && setting.clientSettingEnum.item === 'I18N_LANGUAGE');

    if (language) {
        // YouTube reads the interface language from a cookie, so changing it
        // means writing the cookie and reloading rather than setting a field.
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

        // An array setting is a set of checkboxes, and the command carries the
        // one that was pressed. A new array rather than a splice in place, so
        // the value handed to configWrite is never the one already stored.
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

// YouTube's playback settings panel gets two edits: its speed row is pointed
// at this app's finer-grained speed menu, and a mini player button is added.
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

// Starting a video ends any mini player that was running.
const forgetMiniPlayer = (command) => {
    if (!command.watchEndpoint || !command.watchEndpoint.videoId) return PASS;

    window.isPipPlaying = false;

    const container = document.querySelector('ytlr-player-container');
    if (container) container.style.removeProperty('z-index');

    return PASS;
};

// A batch is a list of commands. Ours are performed here; the rest go back
// through the resolver one at a time.
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

// YouTube asks "who's watching?" on the way out of the app. Answering it is a
// screen nobody wants between them and the home button.
const skipWhosWatchingOnExit = (command, original, self, context) => {
    const request = command.requestAccountSelectorCommand;

    const onExit = request
        && request.identityActionContext
        && request.identityActionContext.eventTrigger === 'ACCOUNT_EVENT_TRIGGER_ON_EXIT';

    if (!onExit || configRead('enableWhosWatchingMenuOnAppExit')) return PASS;

    original.call(self, { signalAction: { signal: 'EXIT_APP' } }, context);
    return false;
};

// ── Installing ────────────────────────────────────────────────────────

const INTERPRETERS = [
    applyOurSettings,
    runCustomActions,
    dressPlaybackSettings,
    forgetMiniPlayer,
    runCommandBatch,
    skipWhosWatchingOnExit
];

/**
 * Wraps YouTube's resolver. Returns false when the resolver cannot be found,
 * which happens if this runs before YouTube's bundle has registered — the
 * caller retries rather than this failing silently.
 */
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
