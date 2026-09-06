import { configRead, configChangeEmitter } from '../config.js';
import { chooseQuality, shouldAsk } from './quality.js';

const PLAYER = '.html5-video-player';
const QUALITY = 'preferredVideoQuality';

const CHECK_INTERVAL = 3000;

// Fast while the page is settling, then easing off: a page with no player must not poll at 10Hz
// for as long as it is open.
const ATTACH_FAST = 100;
const ATTACH_SLOW = 1000;
const ATTACH_SETTLING = 50;

// Asking restarts the stream, so a rung the player will not take is dropped after a few tries.
const LIMITS = { maxAttempts: 3, retryDelay: 5000 };

const RESTART_JUMP = 2;

class PreferredQualityHandler {
    #player = null;
    #attachTimeout = null;
    #attachAttempts = 0;

    #lastVideoId = null;
    #lastTime = 0;

    #target = null;
    #attempts = 0;
    #askedAt = 0;

    // Without this, a quality chosen from the player's own menu is overridden on the next tick.
    #settled = false;


    constructor() {
        this.#pollForPlayer();

        configChangeEmitter.addEventListener('configChange', (event) => {
            if (event.detail?.key !== QUALITY) return;

            this.#forget();
            this.#tick();
        });

        setInterval(() => this.#tick(), CHECK_INTERVAL);
    }

    #pollForPlayer = () => {
        clearTimeout(this.#attachTimeout);

        const found = document.querySelector(PLAYER);

        if (!found) {
            this.#attachAttempts += 1;
            this.#attachTimeout = setTimeout(this.#pollForPlayer,
                this.#attachAttempts < ATTACH_SETTLING ? ATTACH_FAST : ATTACH_SLOW);
            return;
        }

        this.#attachAttempts = 0;
        this.#player = found;
        this.#player.addEventListener('onStateChange', this.#tick);
        this.#tick();
    };

    #forget() {
        this.#target = null;
        this.#attempts = 0;
        this.#askedAt = 0;
        this.#settled = false;
    }

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
            return Object.values(this.#player.getVideoStats()).some((value) => value === 'shortspage');
        } catch (e) {
            return false;
        }
    }

    #tick = () => {
        if (!this.#player) return;

        // The player element is replaced on some navigations, which leaves the listener on a node
        // nothing plays through any more.
        if (this.#player.isConnected === false) {
            this.#player = null;
            this.#forget();
            this.#pollForPlayer();
            return;
        }

        try {
            if (this.#startedOver()) this.#forget();

            if (this.#settled) return;

            const preference = configRead(QUALITY);
            if (!preference || preference === 'auto') return;
            if (!this.#player.getPlayerStateObject?.()?.isPlaying) return;
            if (this.#isShorts()) return;

            const chosen = chooseQuality(preference, this.#player.getAvailableQualityData());
            if (!chosen) return;

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
            console.warn('[tube] could not apply the preferred quality:', e);
        }
    };
}

// Not inside Cobalt's container. Asking restarts the stream, and the container's player does not
// report the rung back under the name we asked for, so the retry never settles — three asks, five
// seconds apart, and the third wedges playback for good about fifteen seconds in.
const inCobalt = typeof navigator !== 'undefined' && /Cobalt/i.test(navigator.userAgent || '');

if (typeof window !== 'undefined' && !inCobalt) {
    window.preferredVideoQualityHandler = new PreferredQualityHandler();
}
