import { configRead, configChangeEmitter } from "../config.js";
import { chooseQuality } from './quality.js';

const SELECTORS = {
    PLAYER: '.html5-video-player',
};

const EVENTS = {
    YT_STATE_CHANGE: 'onStateChange',
    CONFIG_CHANGE: 'configChange',
};

const CONFIG_KEYS = {
    QUALITY: 'preferredVideoQuality',
};

// How long after a video starts its rungs are still worth re-checking, and how often.
// Long enough for SABR to have offered everything it is going to; short enough that a
// television is not asking a question forever.
const IMPROVE_WINDOW = 120000;
const IMPROVE_INTERVAL = 2000;

class PreferredQualityHandler {
    #player = null;
    #attachTimeout = null;
    #lastVideoId = null;
    // The height actually pinned, so a better rung appearing later can be recognised.
    #appliedPixels = 0;
    #watchUntil = 0;

    constructor() {
        this.init();
    }

    init() {
        this.#pollForPlayer();
        this.#setupConfigListener();
        this.#watch();
    }

    #pollForPlayer() {
        clearTimeout(this.#attachTimeout);

        const playerElement = document.querySelector(SELECTORS.PLAYER);

        if (!playerElement) {
            this.#attachTimeout = setTimeout(() => this.#pollForPlayer(), 100);
            return;
        }

        this.#player = playerElement;

        this.#player.addEventListener(EVENTS.YT_STATE_CHANGE, this.#handleStateChange);

        this.#handleStateChange();
    }

    #setupConfigListener() {
        configChangeEmitter.addEventListener(EVENTS.CONFIG_CHANGE, (ev) => {
            if (ev.detail?.key === CONFIG_KEYS.QUALITY) {
                // An explicit choice overrides what is pinned, in either direction.
                this.#appliedPixels = 0;
                this.#watchUntil = Date.now() + IMPROVE_WINDOW;
                this.#applyQuality();
            }
        });
    }

    #handleStateChange = () => {
        const state = this.#player?.getPlayerStateObject?.();
        const videoData = this.#player?.getVideoData?.();
        const videoId = videoData?.video_id;

        if (videoId !== this.#lastVideoId) {
            this.#lastVideoId = videoId;
            this.#appliedPixels = 0;
            // A new video re-opens the window: its rungs are discovered from scratch.
            this.#watchUntil = Date.now() + IMPROVE_WINDOW;
        }

        const isShorts = Object.values(this.#player.getVideoStats()).find(a => a && a === 'shortspage');
        if (state?.isPlaying && !isShorts) this.#applyQuality();
    };

    // The rungs a video offers are not all known when it starts playing: under SABR they
    // appear as the stream is explored, and the list a second in is routinely shorter
    // than the list ten seconds in. Applying once and pinning both ends therefore locks
    // playback to whatever happened to be known at that instant — on a 4K stream that is
    // often a rung or two below the best, on a buffer with nothing wrong with it, with no
    // way back up. So the choice is revisited while it can still improve.
    #watch() {
        setInterval(() => {
            if (!this.#player || Date.now() > this.#watchUntil) return;

            const state = this.#player.getPlayerStateObject?.();
            if (state?.isPlaying) this.#applyQuality();
        }, IMPROVE_INTERVAL);
    }

    #applyQuality() {
        const preferredQuality = configRead(CONFIG_KEYS.QUALITY);
        if (!preferredQuality || preferredQuality === 'auto' || !this.#player) return;

        try {
            const chosen = chooseQuality(preferredQuality, this.#player.getAvailableQualityData());
            if (!chosen) return;

            // Only ever upward. Re-pinning the same rung every couple of seconds would
            // restart the stream for nothing, and stepping down is the player's call.
            if (chosen.pixels <= this.#appliedPixels) return;

            this.#player.setPlaybackQualityRange(chosen.quality, chosen.quality);
            this.#appliedPixels = chosen.pixels;
        } catch (e) {
            console.warn('[PreferredQuality] Failed to apply quality:', e);
        }
    }

}

window.preferredVideoQualityHandler = new PreferredQualityHandler();
