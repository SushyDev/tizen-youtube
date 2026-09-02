import { configRead } from '../config.js';
import { noteSpeed } from '../features/nativePlayback.js';
import { showModal, buttonItem, overlayPanelItemListRenderer } from './ytUI.js';

const interval = setInterval(() => {
    const videoElement = document.querySelector('video');
    if (videoElement) {
        execute_once_dom_loaded_speed();
        clearInterval(interval);
    }
}, 1000);

function execute_once_dom_loaded_speed() {
    document.querySelector('video').addEventListener('canplay', () => {
        if (!configRead('rememberPlaybackSpeed')) return;

        const speed = configRead('videoSpeed');
        const video = document.querySelector('video');
        if (video) video.playbackRate = speed;

        // Carrying a speed into a new video decides which pipeline can play it, the same
        // as choosing one does.
        noteSpeed(speed);
    });

    const eventHandler = (evt) => {
        if (evt.keyCode == 406 || evt.keyCode == 191) {
            evt.preventDefault();
            evt.stopPropagation();
            if (evt.type === 'keydown') {
                openSpeedOptions();
                return false;
            }
            return true;
        };
    }

    // Red, Green, Yellow, Blue
    // 403, 404, 405, 406
    // ---, 172, 170, 191
    document.addEventListener('keydown', eventHandler, true);
    document.addEventListener('keypress', eventHandler, true);
    document.addEventListener('keyup', eventHandler, true);
}

/**
 * The rate the video is actually running at.
 *
 * Not the stored one. The store is only consulted when the speed is meant to be remembered,
 * and it is written either way — so reading it would leave the menu opening on a rung the
 * viewer chose during some earlier video and the player long since abandoned.
 */
function currentRate() {
    const video = document.querySelector('video');
    if (video && video.playbackRate > 0) return Math.round(video.playbackRate * 100) / 100;

    return configRead('rememberPlaybackSpeed') ? configRead('videoSpeed') : 1;
}

function openSpeedOptions() {
    const currentSpeed = currentRate();
    let selectedIndex = 0;
    const maxSpeed = 5;
    const increment = configRead('speedSettingsIncrement') || 0.25;
    const buttons = [];
    for (let speed = increment; speed <= maxSpeed; speed += increment) {
        const fixedSpeed = Math.round(speed * 100) / 100;
        buttons.push(
            buttonItem(
                { title: `${fixedSpeed}x` },
                null,
                [
                    {
                        signalAction: {
                            signal: 'POPUP_BACK'
                        }
                    },
                    {
                        setClientSettingEndpoint: {
                            settingDatas: [
                                {
                                    clientSettingEnum: {
                                        item: 'videoSpeed'
                                    },
                                    intValue: fixedSpeed.toString()
                                }
                            ]
                        }
                    },
                    {
                        customAction: {
                            action: 'SET_PLAYER_SPEED',
                            parameters: fixedSpeed.toString()
                        }
                    }
                ]
            )
        );
        if (currentSpeed === fixedSpeed) {
            selectedIndex = buttons.length - 1;
        }
    }

    showModal('Playback Speed', overlayPanelItemListRenderer(buttons, selectedIndex), 'options-speed');
}

export {
    openSpeedOptions
}