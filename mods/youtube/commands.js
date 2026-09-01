import { configRead, configWrite } from '../config.js';
import { findResolver, resolve } from './internals.js';
import { openOptions, OPTIONS_ACTION } from '../ui/settingsOptions.js';
import { openSpeedOptions } from '../ui/speedUI.js';
import { showToast, buttonItem, MenuServiceItemRenderer } from '../ui/ytUI.js';
import { tileFor, snapshotTile } from './tileRegistry.js';
import { enterMiniPlayer } from '../features/pictureInPicture.js';

// YouTube routes everything through a single `resolveCommand` on one singleton, so
// wrapping it is how this app's settings end up behaving exactly like YouTube's.
//
// The wrapper is a list of interpreters, each asked in turn whether a command is
// theirs. An interpreter answers with a result, or hands the command on untouched.

// What an interpreter returns when the command is not its business.
const PASS = { pass: true };

const APP_NAME = 'YouTube';

// Commands YouTube has never heard of, carried under `customAction` so they travel
// the same rails as everything else.
const ACTIONS = {
    // A settings row asking for the list of answers it offers.
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

// A setting YouTube does not recognise is one of ours: its own all have underscored
// enum names, ours are the config keys themselves.
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

        // An array setting is a set of checkboxes and the command carries the one
        // pressed. A new array, so configWrite never gets the stored one back.
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

// The speed row points at this app's finer-grained menu, and a mini player button is added.
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

// The queue entry, added when a long-press menu is actually opened rather than built
// into every tile of every shelf at parse time. `tileRegistry` holds the tile beside
// the command instead of inside it, so nothing is cloned until there is a menu on
// screen and exactly one tile it could be about.
const offerQueueEntry = (command) => {
    const items = command.showMenuCommand
        && command.showMenuCommand.menu
        && command.showMenuCommand.menu.menuRenderer
        && command.showMenuCommand.menu.menuRenderer.items;

    if (!items) return PASS;

    const tile = tileFor(command);
    if (!tile) return PASS;

    // The same menu can be opened repeatedly, and YouTube keeps the command object.
    const already = items.some((entry) => {
        const action = entry
            && entry.menuServiceItemRenderer
            && entry.menuServiceItemRenderer.serviceEndpoint
            && entry.menuServiceItemRenderer.serviceEndpoint.playlistEditEndpoint
            && entry.menuServiceItemRenderer.serviceEndpoint.playlistEditEndpoint.customAction;
        return action && action.action === 'ADD_TO_QUEUE';
    });

    if (already) return PASS;

    items.push(MenuServiceItemRenderer('Add to Queue', {
        clickTrackingParams: null,
        playlistEditEndpoint: {
            customAction: {
                action: 'ADD_TO_QUEUE',
                parameters: snapshotTile(tile)
            }
        }
    }));

    // Edited, not answered: YouTube still has to open the menu.
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

// Ours are performed here; the rest go back through the resolver one at a time.
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

// YouTube asks "who's watching?" on the way out. Nobody wants that between them and
// the home button.
const skipWhosWatchingOnExit = (command, original, self, context) => {
    const request = command.requestAccountSelectorCommand;

    const onExit = request
        && request.identityActionContext
        && request.identityActionContext.eventTrigger === 'ACCOUNT_EVENT_TRIGGER_ON_EXIT';

    if (!onExit || configRead('enableWhosWatchingMenuOnAppExit')) return PASS;

    original.call(self, { signalAction: { signal: 'EXIT_APP' } }, context);
    return false;
};

const INTERPRETERS = [
    applyOurSettings,
    runCustomActions,
    dressPlaybackSettings,
    offerQueueEntry,
    forgetMiniPlayer,
    runCommandBatch,
    skipWhosWatchingOnExit
];

/** Wraps YouTube's resolver. False when it is not registered yet; the caller retries. */
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
