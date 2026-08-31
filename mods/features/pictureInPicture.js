// Promoting the player into a corner of the screen, and back out again.

import { resolve as resolveCommand } from "../youtube/internals.js";

// Backing field for the `window.isPipPlaying` accessor defined at the foot of this
// file. Nothing reads the flag during module evaluation, so the accessor can be
// installed after the functions its setter drives.
let pipPlaying = false;
let PlayerService = null;

const PIP_BUTTON_ID = 'mini-player-button';

function pipLoad() {
    const mappings = Object.values(window._yttv).find(a => a && a.mappings);
    PlayerService = mappings.get('PlayerService');
    const PlaybackPreviewService = mappings.get('PlaybackPreviewService');
    const PlaybackPreviewServiceStart = PlaybackPreviewService.start;
    const PlaybackPreviewServiceStop = PlaybackPreviewService.stop;

    PlaybackPreviewService.start = function (...args) {
        if (window.isPipPlaying) return;
        return PlaybackPreviewServiceStart.apply(this, args);
    }

    PlaybackPreviewService.stop = function (...args) {
        if (window.isPipPlaying) return;
        return PlaybackPreviewServiceStop.apply(this, args);
    }
}

if (document.readyState === 'complete') {
    pipLoad();
} else window.addEventListener('load', pipLoad);

function enterMiniPlayer() {
    if (!PlayerService) return;
    const timestamp = Math.floor(document.querySelector('video').currentTime);
    const videoElement = document.querySelector('video');

    const ytlrPlayer = document.querySelector('ytlr-player');
    const ytlrPlayerContainer = document.querySelector('ytlr-player-container');

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class') {
                if (!ytlrPlayer.classList.contains('ytLrPlayerEnabled')) {
                    function setStyles() {
                        ytlrPlayerContainer.style.zIndex = '10';
                        ytlrPlayer.style.display = 'block';
                        ytlrPlayer.style.backgroundColor = 'rgba(0,0,0,0)';
                    }

                    setStyles();
                    setTimeout(setStyles, 500);

                    function onPipEnter() {
                        videoElement.style.removeProperty('inset');
                        const pipWidth = window.innerWidth / 3.5;
                        const pipHeight = window.innerHeight / 3.5;
                        videoElement.style.width = `${pipWidth}px`;
                        videoElement.style.height = `${pipHeight}px`;
                        videoElement.style.top = '68vh';
                        videoElement.style.left = '68vw';

                        window.isPipPlaying = true;
                        videoElement.removeEventListener('play', onPipEnter);
                    }

                    videoElement.addEventListener('play', onPipEnter);
                    observer.disconnect();

                    setTimeout(() => {
                        PlayerService.loadedPlaybackConfig.watchEndpoint.startTimeSeconds = timestamp;
                        PlayerService.loadVideo(PlayerService.loadedPlaybackConfig);
                    }, 1000);
                }
            }
        });
    });

    observer.observe(ytlrPlayer, { attributes: true });

    // Exit from the current video player
    resolveCommand({
        signalAction: {
            signal: "HISTORY_BACK"
        }
    });
}

function pipToFullscreen() {
    const { clickTrackingParams, commandMetadata, watchEndpoint } = PlayerService.loadedPlaybackConfig;
    watchEndpoint.startTimeSeconds = Math.floor(document.querySelector('video').currentTime);
    const command = {
        clickTrackingParams,
        commandMetadata,
        watchEndpoint
    };
    resolveCommand(command);
    window.isPipPlaying = false;
};

const originalClasses = {
    ytlrSearchVoice: {
        length: 0,
        classes: []
    },
    ytlrSearchVoiceMicButton: {
        length: 0,
        classes: []
    }
}

// The button only means anything while the mini player is up, so the observer that
// waits for the search bar is connected on entry and dropped the moment the button
// lands. It used to observe the whole document — childList and subtree, unconditionally,
// for the life of the session. Blink allocates a MutationRecord for every node YouTube's
// renderer adds or removes, and this callback threw all of them away: the early return
// on `isPipPlaying` skipped the body, not the allocation.
let pipButtonObserver = null;
let pipButtonSweep = null;
let iconClassMap;

// Walking YouTube's module registry is the expensive part of building the button and
// the map it finds never changes, so it is looked up once.
function iconClasses() {
    if (iconClassMap === undefined) {
        iconClassMap = Object.values(window._yttv).find((a) => a instanceof Map && a.has('CLEAR_COOKIES')) || null;
    }
    return iconClassMap;
}

function buildPipButton(searchBar) {
    const voiceButton = searchBar.querySelector('ytlr-search-voice');
    const iconClassNames = voiceButton ? iconClasses() : null;

    // Cloning the voice button's classes keeps the button looking native across
    // YouTube's restyles; the branch below is the fallback for a build without one.
    if (voiceButton && iconClassNames) {
        const iconClassToBeRemoved = iconClassNames.get('MICROPHONE_ON');
        const iconClearCookiesClass = iconClassNames.get('CLEAR_COOKIES');
        const pipButton = document.createElement('ytlr-search-voice');

        for (let i = 0; i < voiceButton.classList.length; i++) {
            if (originalClasses.ytlrSearchVoice.length === 0) {
                originalClasses.ytlrSearchVoice.length = voiceButton.classList.length;
            }

            if (originalClasses.ytlrSearchVoice.length !== voiceButton.classList.length) {
                for (const className of originalClasses.ytlrSearchVoice.classes) {
                    pipButton.classList.add(className);
                }
                break;
            }

            if (!originalClasses.ytlrSearchVoice.classes.includes(voiceButton.classList[i]))
                originalClasses.ytlrSearchVoice.classes.push(voiceButton.classList[i]);

            pipButton.classList.add(voiceButton.classList[i]);
        }

        pipButton.style.left = '10.25em';
        pipButton.id = PIP_BUTTON_ID;

        const pipButtonMicButton = document.createElement('ytlr-search-voice-mic-button');
        for (let i = 0; i < voiceButton.children[0].classList.length; i++) {
            if (originalClasses.ytlrSearchVoiceMicButton.length === 0) {
                originalClasses.ytlrSearchVoiceMicButton.length = voiceButton.children[0].classList.length;
            }

            if (originalClasses.ytlrSearchVoiceMicButton.length !== voiceButton.children[0].classList.length) {
                for (const className of originalClasses.ytlrSearchVoiceMicButton.classes) {
                    pipButtonMicButton.classList.add(className);
                }
                break;
            }

            if (!originalClasses.ytlrSearchVoiceMicButton.classes.includes(voiceButton.children[0].classList[i]))
                originalClasses.ytlrSearchVoiceMicButton.classes.push(voiceButton.children[0].classList[i]);

            pipButtonMicButton.classList.add(voiceButton.children[0].classList[i]);
        }

        const pipIcon = document.createElement('yt-icon');
        for (let i = 0; i < voiceButton.children[0].children[0].classList.length; i++) {
            pipIcon.classList.add(voiceButton.children[0].children[0].classList[i]);
        }
        pipIcon.classList.remove(iconClassToBeRemoved);
        pipIcon.classList.add(iconClearCookiesClass);

        pipButtonMicButton.appendChild(pipIcon);
        pipButton.appendChild(pipButtonMicButton);
        searchBar.appendChild(pipButton);
        return true;
    }

    const pipButton = document.createElement('ytlr-search-voice');
    pipButton.style.left = '10.25em';
    pipButton.id = PIP_BUTTON_ID;
    pipButton.setAttribute('idomkey', 'ytLrSearchBarSearchVoice');
    pipButton.setAttribute('tabindex', '0');
    pipButton.classList.add('ytLrSearchVoiceHost', 'ytLrSearchBarSearchVoice');

    const pipButtonMicButton = document.createElement('ytlr-search-voice-mic-button');
    pipButtonMicButton.setAttribute('hybridnavfocusable', 'true');
    pipButtonMicButton.setAttribute('tabindex', '-1');
    pipButtonMicButton.classList.add('ytLrSearchVoiceMicButtonHost', 'zylon-ve');

    const pipIcon = document.createElement('yt-icon');
    pipIcon.setAttribute('tabindex', '-1');
    pipIcon.classList.add('ytContribIconTvArrowLeft', 'ytContribIconHost', 'ytLrSearchVoiceMicButtonIcon');

    pipButtonMicButton.appendChild(pipIcon);
    pipButton.appendChild(pipButtonMicButton);
    searchBar.appendChild(pipButton);
    return true;
}

/** One attempt. True when there is nothing left to wait for. */
function ensurePipButton() {
    if (!window.isPipPlaying) return true;
    // The old guard looked for `#tt-pip-button` while the button it built was
    // `mini-player-button`, so it never matched and a fresh button was appended on
    // every mutation batch for as long as the mini player was up.
    if (document.getElementById(PIP_BUTTON_ID)) return true;

    const searchBar = document.querySelector('ytlr-search-bar');
    if (!searchBar) return false;

    return buildPipButton(searchBar);
}

// A batch of several hundred records has to cost one pass, not several hundred.
function sweepForSearchBar() {
    if (pipButtonSweep) return;
    pipButtonSweep = setTimeout(() => {
        pipButtonSweep = null;
        if (ensurePipButton()) stopWatchingForSearchBar();
    }, 0);
}

function watchForSearchBar() {
    if (pipButtonObserver || typeof MutationObserver !== 'function') return;
    pipButtonObserver = new MutationObserver(sweepForSearchBar);
    // The search bar can be built anywhere under body, so the scope cannot be narrowed
    // — the lifetime can, and that is what makes this affordable.
    pipButtonObserver.observe(document.body, { childList: true, subtree: true });
}

function stopWatchingForSearchBar() {
    if (pipButtonObserver) {
        pipButtonObserver.disconnect();
        pipButtonObserver = null;
    }
    if (pipButtonSweep) {
        clearTimeout(pipButtonSweep);
        pipButtonSweep = null;
    }
}

function removePipButton() {
    const existing = document.getElementById(PIP_BUTTON_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
}

// `window.isPipPlaying` is read from ui.js and written from both ends of the mini
// player, so the observer's lifetime hangs off the flag itself rather than off every
// call site remembering to start and stop it. Configurable, so it can be replaced.
Object.defineProperty(window, 'isPipPlaying', {
    configurable: true,
    enumerable: true,
    get() {
        return pipPlaying;
    },
    set(value) {
        const next = !!value;
        if (next === pipPlaying) return;
        pipPlaying = next;

        if (next) {
            if (!ensurePipButton()) watchForSearchBar();
        } else {
            stopWatchingForSearchBar();
            removePipButton();
        }
    }
});

export {
    enterMiniPlayer,
    pipToFullscreen
}
