import { configRead, configChangeEmitter } from "../config.js";
import { chooseQuality, shouldAsk } from './quality.js';

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

const CHECK_INTERVAL = 3000;

// Asking restarts the stream, so a rung the player will not take is asked for a few times
// and then left alone until the next video.
const LIMITS = { maxAttempts: 3, retryDelay: 5000 };

// Below this, a jump backwards is a seek; above it, the video started over.
const RESTART_JUMP = 2;

class PreferredQualityHandler {
    #player = null;
    #attachTimeout = null;

    #lastVideoId = null;
    #lastTime = 0;

    #target = null;
    #attempts = 0;
    #askedAt = 0;

    // A preference is what to start on, not a rung to hold: without this, choosing another
    // quality from the player's own menu was overridden again within the tick.
    #settled = false;

    // A deliberate restart looks exactly like a new video from here — same id, time back at
    // the start — and applying the preference to it would undo the choice that caused it.
    #keepChoice = false;

    keepCurrentChoice() {
        this.#keepChoice = true;
        this.#settled = true;
        this.#attempts = 0;
        this.#target = null;
    }

    constructor() {
        this.init();
    }

    init() {
        this.#pollForPlayer();
        this.#setupConfigListener();
        setInterval(() => this.#tick(), CHECK_INTERVAL);
    }

    #pollForPlayer() {
        clearTimeout(this.#attachTimeout);

        const playerElement = document.querySelector(SELECTORS.PLAYER);

        if (!playerElement) {
            this.#attachTimeout = setTimeout(() => this.#pollForPlayer(), 100);
            return;
        }

        this.#player = playerElement;
        this.#player.addEventListener(EVENTS.YT_STATE_CHANGE, this.#tick);
        this.#tick();
    }

    #setupConfigListener() {
        configChangeEmitter.addEventListener(EVENTS.CONFIG_CHANGE, (ev) => {
            if (ev.detail?.key !== CONFIG_KEYS.QUALITY) return;
            this.#forget();
            this.#tick();
        });
    }

    #forget() {
        this.#target = null;
        this.#attempts = 0;
        this.#askedAt = 0;
        this.#settled = false;
    }

    // A new id or a jump back to the start: autoplay, play next, replay and repeat all arrive
    // here. Repeat was missed before, since its id never changes.
    #startedOver() {
        const id = this.#player.getVideoData?.()?.video_id;
        const time = this.#player.getCurrentTime?.() ?? 0;
        const looped = time + RESTART_JUMP < this.#lastTime;

        this.#lastTime = time;

        if (id === this.#lastVideoId && !looped) return false;

        this.#lastVideoId = id;
        return true;
    }

    #isShorts() {
        try {
            return Object.values(this.#player.getVideoStats()).some((a) => a === 'shortspage');
        } catch (e) {
            return false;
        }
    }

    #tick = () => {
        if (!this.#player) return;

        try {
            if (this.#startedOver()) {
                if (this.#keepChoice) {
                    this.#keepChoice = false;
                    this.#settled = true;
                } else {
                    this.#forget();
                }
            }

            const preference = configRead(CONFIG_KEYS.QUALITY);
            if (!preference || preference === 'auto') return;
            if (!this.#player.getPlayerStateObject?.()?.isPlaying) return;
            if (this.#isShorts()) return;

            const chosen = chooseQuality(preference, this.#player.getAvailableQualityData());
            if (!chosen) return;

            if (this.#settled) return;

            const current = this.#player.getPlaybackQuality();
            if (current === chosen.quality) {
                this.#attempts = 0;
                this.#settled = true;
                return;
            }

            const again = chosen.quality === this.#target;
            const state = {
                current,
                wanted: chosen.quality,
                target: this.#target,
                attempts: this.#attempts,
                askedAt: this.#askedAt
            };
            if (!shouldAsk(state, Date.now(), LIMITS)) return;

            this.#player.setPlaybackQualityRange(chosen.quality, chosen.quality);
            this.#target = chosen.quality;
            this.#attempts = again ? this.#attempts + 1 : 1;
            this.#askedAt = Date.now();
        } catch (e) {
            console.warn('[PreferredQuality] Failed to apply quality:', e);
        }
    };
}

if (typeof window !== 'undefined') window.preferredVideoQualityHandler = new PreferredQualityHandler();

export function keepCurrentChoice() {
    if (typeof window !== 'undefined') window.preferredVideoQualityHandler.keepCurrentChoice();
}
