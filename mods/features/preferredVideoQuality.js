import { configRead, configChangeEmitter } from '../config.js';
import { waitFor } from '../utils/waitFor.js';
import { chooseQuality, shouldAsk } from './quality.js';

const PLAYER = '.html5-video-player';
const QUALITY = 'preferredVideoQuality';

const CHECK_INTERVAL = 3000;
const ATTACH_EVERY = 250;

// Asking restarts the stream, so a rung the player will not take is dropped after a few tries.
const LIMITS = { maxAttempts: 3, retryDelay: 5000 };

const RESTART_JUMP = 2;

function watchPreferredQuality() {
    // Everything that changes, in one place: which player we are attached to, which rung we last
    // asked for, and whether the choice has settled.
    const held = {
        player: null,
        lastVideoId: null,
        lastTime: 0,
        target: null,
        attempts: 0,
        askedAt: 0,
        // Without this, a quality chosen from the player's own menu is overridden on the next tick.
        settled: false
    };

    const forget = () => {
        held.target = null;
        held.attempts = 0;
        held.askedAt = 0;
        held.settled = false;
    };

    const startedOver = (player) => {
        const id = player.getVideoData?.()?.video_id;
        const time = player.getCurrentTime?.() ?? 0;
        const looped = time + RESTART_JUMP < held.lastTime;

        held.lastTime = time;

        if (id === held.lastVideoId && !looped) return false;

        held.lastVideoId = id;
        return true;
    };

    const isShorts = (player) => {
        try {
            return Object.values(player.getVideoStats()).some((value) => value === 'shortspage');
        } catch (e) {
            return false;
        }
    };

    const askFor = (player, chosen, current) => {
        const again = chosen.quality === held.target;

        const state = {
            current,
            wanted: chosen.quality,
            target: held.target,
            attempts: held.attempts,
            askedAt: held.askedAt
        };

        if (!shouldAsk(state, Date.now(), LIMITS)) return;

        player.setPlaybackQualityRange(chosen.quality, chosen.quality);
        held.target = chosen.quality;
        held.attempts = again ? held.attempts + 1 : 1;
        held.askedAt = Date.now();
    };

    const applyPreference = (player) => {
        if (startedOver(player)) forget();
        if (held.settled) return;

        const preference = configRead(QUALITY);
        if (!preference || preference === 'auto') return;
        if (!player.getPlayerStateObject?.()?.isPlaying) return;
        if (isShorts(player)) return;

        const chosen = chooseQuality(preference, player.getAvailableQualityData());
        if (!chosen) return;

        const current = player.getPlaybackQuality();

        if (current === chosen.quality) {
            held.attempts = 0;
            held.settled = true;
            return;
        }

        askFor(player, chosen, current);
    };

    const attachToPlayer = () => waitFor(
        () => document.querySelector(PLAYER),
        (player) => {
            held.player = player;
            player.addEventListener('onStateChange', tick);
            tick();
        },
        { every: ATTACH_EVERY }
    );

    function tick() {
        if (!held.player) return;

        // The player element is replaced on some navigations, which leaves the listener on a node
        // nothing plays through any more.
        if (held.player.isConnected === false) {
            held.player = null;
            forget();
            attachToPlayer();
            return;
        }

        try {
            applyPreference(held.player);
        } catch (e) {
            console.warn('[tube] could not apply the preferred quality:', e);
        }
    }

    configChangeEmitter.addEventListener('configChange', (event) => {
        if (event.detail?.key !== QUALITY) return;

        forget();
        tick();
    });

    setInterval(tick, CHECK_INTERVAL);
    attachToPlayer();
}

// Not inside Cobalt's container. Asking restarts the stream, and the container's player does not
// report the rung back under the name we asked for, so the retry never settles — three asks, five
// seconds apart, and the third wedges playback for good about fifteen seconds in.
const inCobalt = typeof navigator !== 'undefined' && /Cobalt/i.test(navigator.userAgent || '');

if (typeof window !== 'undefined' && !inCobalt) watchPreferredQuality();
