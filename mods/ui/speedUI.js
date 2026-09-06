import { configRead } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer } from './ytUI.js';
import { waitFor } from '../utils/waitFor.js';

const SPEED_KEYS = [406, 191];

const MAX_SPEED = 5;
const DEFAULT_INCREMENT = 0.25;

const WAIT_INTERVAL = 1000;
const WAIT_WINDOW = 60000;

const round = (value) => Math.round(value * 100) / 100;

const currentRate = () => {
    const video = document.querySelector('video');
    if (video && video.playbackRate > 0) return round(video.playbackRate);

    return configRead('rememberPlaybackSpeed') ? configRead('videoSpeed') : 1;
};

const speedButton = (speed) => buttonItem({ title: `${speed}x` }, null, [
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

    showModal(
        'Playback Speed',
        overlayPanelItemListRenderer(rungs.map(speedButton), chosen === -1 ? 0 : chosen),
        'options-speed'
    );
}

const attach = (video) => {
    video.addEventListener('canplay', () => {
        if (!configRead('rememberPlaybackSpeed')) return;
        video.playbackRate = configRead('videoSpeed');
    });

    const onKey = (event) => {
        if (SPEED_KEYS.indexOf(event.keyCode) === -1) return;

        event.preventDefault();
        event.stopPropagation();

        if (event.type === 'keydown') openSpeedOptions();
    };

    ['keydown', 'keypress', 'keyup'].forEach((type) => document.addEventListener(type, onKey, true));
};

waitFor(() => document.querySelector('video'), attach, { every: WAIT_INTERVAL, forMs: WAIT_WINDOW });

export { openSpeedOptions };
