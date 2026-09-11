import { configRead } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer } from './ytUI.js';
import { waitFor } from '../utils/waitFor.js';

const SPEED_KEYS = [406, 191];

const MAX_SPEED = 5;
const DEFAULT_INCREMENT = 0.25;
const STUTTER_FIX = 1.0001;

const WAIT_INTERVAL = 1000;

const round = (value) => Math.round(value * 100) / 100;

const currentRate = () => {
    const video = document.querySelector('video');
    if (video && video.playbackRate > 0) return round(video.playbackRate);

    return configRead('rememberPlaybackSpeed') ? configRead('videoSpeed') : 1;
};

const speedButton = (speed, title = `${speed}x`) => buttonItem({ title }, null, [
    { signalAction: { signal: 'POPUP_BACK' } },
    {
        setClientSettingEndpoint: {
            settingDatas: [{ clientSettingEnum: { item: 'videoSpeed' }, intValue: speed.toString() }]
        }
    },
    { customAction: { action: 'SET_PLAYER_SPEED', parameters: speed.toString() } }
]);

const speedLadder = () => {
    const increment = configRead('speedSettingsIncrement') || DEFAULT_INCREMENT;
    const rungs = Math.floor(MAX_SPEED / increment);

    return Array.from({ length: rungs }, (_, step) => round((step + 1) * increment));
};

function openSpeedOptions() {
    const rungs = speedLadder();
    const chosen = rungs.indexOf(currentRate());
    const buttons = rungs.map((speed) => speedButton(speed))
        .concat([speedButton(STUTTER_FIX, `Fix stuttering (${STUTTER_FIX}x)`)]);

    showModal(
        'Playback Speed',
        overlayPanelItemListRenderer(buttons, chosen === -1 ? 0 : chosen),
        'options-speed'
    );
}

const keepSpeed = (event) => {
    if (!(event.target instanceof window.HTMLVideoElement) || !configRead('rememberPlaybackSpeed')) return;
    event.target.playbackRate = configRead('videoSpeed');
};

const attach = () => {
    const onKey = (event) => {
        if (SPEED_KEYS.indexOf(event.keyCode) === -1) return;

        event.preventDefault();
        event.stopPropagation();

        if (event.type === 'keydown') openSpeedOptions();
    };

    ['keydown', 'keypress', 'keyup'].forEach((type) => document.addEventListener(type, onKey, true));
};

document.addEventListener('canplay', keepSpeed, true);
waitFor(() => document.querySelector('video'), attach, { everyMs: WAIT_INTERVAL, forMs: Infinity });

export { openSpeedOptions };
