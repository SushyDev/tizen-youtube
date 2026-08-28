import { configRead, configChangeEmitter } from "../config.js";

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

class PreferredQualityHandler {
    #player = null;
    #attachTimeout = null;
    #lastVideoId = null;
    #hasAppliedQuality = false;

    constructor() {
        this.init();
    }

    init() {
        this.#pollForPlayer();
        this.#setupConfigListener();
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
            this.#hasAppliedQuality = false;
        }

        const isShorts = Object.values(this.#player.getVideoStats()).find(a => a && a === 'shortspage');
        if (state?.isPlaying && !this.#hasAppliedQuality && !isShorts) {
            this.#applyQuality();
            this.#hasAppliedQuality = true;
        }
    };

    #applyQuality() {
        const preferredQuality = configRead(CONFIG_KEYS.QUALITY);
        if (!preferredQuality || preferredQuality === 'auto' || !this.#player) return;

        try {
            const quality = this.#determineQuality(preferredQuality);

            if (quality) {
              this.#player.setPlaybackQualityRange(quality, quality)
            }
        } catch (e) {
            console.warn('[PreferredQuality] Failed to apply quality:', e);
        }
    }

    // YouTube names qualities with constants ('hd1080', 'hd2160') and labels them with
    // numbers ('1080p'). Asking for one the video does not have is not reported — the
    // player just keeps what it had — so every answer comes from the list it offers.
    #determineQuality(preference) {
        const available = this.#player.getAvailableQualityData();
        if (!available?.length) return null;

        const pixels = (entry) => parseInt(entry.qualityLabel, 10) || 0;

        // 'highest' is an instruction, not a resolution: take the top of whatever this
        // video offers. Unlike naming a resolution, it cannot silently do nothing.
        if (preference === 'highest') {
            return available.reduce((best, entry) => (pixels(entry) > pixels(best) ? entry : best)).quality;
        }

        const target = parseInt(preference, 10) || 0;
        const match = available.find((entry) => pixels(entry) === target);

        // The nearest below beats falling back to the maximum, which would be the
        // opposite of what a resolution cap is for.
        if (match) return match.quality;

        const below = available
            .filter((entry) => pixels(entry) <= target)
            .reduce((best, entry) => (!best || pixels(entry) > pixels(best) ? entry : best), null);

        return below ? below.quality : null;
    }
}

window.preferredVideoQualityHandler = new PreferredQualityHandler();
