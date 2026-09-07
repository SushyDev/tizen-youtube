// @ts-nocheck — owned by a live sibling branch; reshaping it here would conflict on every
// restack. It comes under the type checker when those branches land.
import { PASS, buttonItem, configRead, configWrite, onCommand, resolve, showToast } from '../../framework/index.js';
import { openOptions, OPTIONS_ACTION } from '../settings/settingsOptions.js';
import { openSpeedOptions } from '../player/speed.js';
import { enterMiniPlayer } from '../player/pictureInPicture.js';


const APP_NAME = 'YouTube';

const ACTIONS = {
    [OPTIONS_ACTION]: (parameters) => openOptions(parameters),

    OPEN_SPEED_OPTIONS: () => openSpeedOptions(),

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

const applyOurSettings = (command) => {
    const endpoint = command.setClientSettingEndpoint;
    if (!endpoint || !endpoint.settingDatas) return PASS;

    const language = endpoint.settingDatas.find((setting) =>
        setting.clientSettingEnum && setting.clientSettingEnum.item === 'I18N_LANGUAGE');

    if (language) {
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

// The triggers that mean "before anything has been asked for", as against a locked account, a PIN
// or an upgrade, where a real answer is needed.
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

const INTERPRETERS = [
    applyOurSettings,
    runCustomActions,
    dressPlaybackSettings,
    forgetMiniPlayer,
    runCommandBatch,
    skipWhosWatchingOnExit,
    skipWhosWatchingOnArrival
];

// Named here rather than taken from each function, because terser mangles our own names and an
// error would otherwise be reported as coming from `t`.
const NAMES = [
    'our settings',
    'custom actions',
    'playback settings',
    'mini player',
    'command batch',
    'whos watching on exit',
    'whos watching on arrival'
];

// The patch itself moved to the framework, which owns the one wrapper. These only say what they
// want to be asked about; the sentinel and the order are unchanged.
const claimInterpreters = () => INTERPRETERS.forEach((interpret, index) =>
    onCommand(NAMES[index] || `interpreter ${index}`, (command, at) =>
        interpret(command, at.original, at.self, at.context)));

export { claimInterpreters, APP_NAME };
