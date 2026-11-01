import { buttonItem, configRead, onKey, overlayPanelItemListRenderer, showModal, whenVideo } from '../../framework/index.js';

const SPEED_KEYS = [406, 191];

const MAX_SPEED = 5;
const DEFAULT_INCREMENT = 0.25;
const STUTTER_FIX = 1.0001;

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

// Cobalt keeps one <video> for video after video and its playbackRate with it, so with remembering
// off a speed chosen once still carried on. Each new source starts at the speed it should; a
// canplay after a seek or a stall is the same source, and a speed chosen meanwhile is kept.
const startingRate = () => (configRead('rememberPlaybackSpeed') ? configRead('videoSpeed') : 1);

const rememberSpeed = (video) => {
    const held = { source: null };

    video.addEventListener('canplay', () => {
        const source = video.currentSrc || video.src;
        if (source && source === held.source) return;
        held.source = source;

        const wanted = startingRate();
        if (video.playbackRate !== wanted) video.playbackRate = wanted;
    });
};

// Returning true swallows all three event types, but only keydown opens the menu.
const claimSpeedKeys = () => onKey('playback speed', SPEED_KEYS, (event) => {
    if (event.type === 'keydown') openSpeedOptions();
    return true;
});

const start = () => {
    claimSpeedKeys();
    whenVideo('playback speed', rememberSpeed);
};

export { openSpeedOptions, rememberSpeed, start };
