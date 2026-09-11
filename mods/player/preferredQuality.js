import { PLAYER, configChangeEmitter, configRead, every, onResponse, stop, until, waitFor, whenPlayer } from '../../framework/index.js';
import { NAMED, chooseQuality } from './qualityLadder.js';
import { LIMITS, shouldAsk } from './askBudget.js';
import { QUALITY, liftCeiling, seedPreferredQuality } from './qualitySeed.js';

// Keeps the playing video on the preferred rung: pinned at attach, settled after each player
// response, re-checked on a heartbeat.

const CHECK_INTERVAL = 3000;

const SETTLING_EVERY = 250;
const SETTLING_FOR = 8000;

// Seconds. A video whose position jumps this far backwards has looped, and a loop is a fresh
// video as far as the choice is concerned.
const RESTART_JUMP = 2;

function watchPreferredQuality() {
    const held = {
        player: null,
        lastVideoId: null,
        lastTime: 0,
        pinned: null,
        target: null,
        attempts: 0,
        askedAt: 0,
        // Without this, a quality chosen from the player's own menu is overridden on the next tick.
        settledOn: null
    };

    const forget = () => {
        held.target = null;
        held.attempts = 0;
        held.askedAt = 0;
        held.settledOn = null;
    };

    const startedOver = (player) => {
        const id = player.getVideoData?.()?.video_id;
        const time = player.getCurrentTime?.() ?? 0;
        const looped = time < RESTART_JUMP && time + RESTART_JUMP < held.lastTime;

        held.lastTime = time;

        if (id === held.lastVideoId && !looped) return false;

        held.lastVideoId = id;
        return true;
    };

    // Shorts are vertical and short; forcing 2160p on one spends the link on a video that was
    // never going to show it.
    const isShorts = (player) => {
        try {
            return Object.values(player.getVideoStats()).some((value) => value === 'shortspage');
        } catch (e) {
            return false;
        }
    };

    const askFor = (player, chosen, current) => {
        const again = chosen === held.target;

        const state = {
            current,
            wanted: chosen,
            again,
            attempts: held.attempts,
            askedAt: held.askedAt
        };

        if (!shouldAsk(state, Date.now(), LIMITS)) return;

        player.setPlaybackQualityRange(chosen, chosen);
        held.target = chosen;
        held.attempts = again ? held.attempts + 1 : 1;
        held.askedAt = Date.now();
    };

    const applyPreference = (player) => {
        if (startedOver(player)) forget();

        const preference = configRead(QUALITY);
        if (!preference || preference === 'auto') return;
        if (isShorts(player)) return;

        const chosen = chooseQuality(preference, player.getAvailableQualityData());
        if (!chosen) return;

        // The ladder grows after playback starts, so a settlement holds only while the chosen rung
        // is unchanged.
        if (held.settledOn === chosen) return;
        held.settledOn = null;

        if (held.pinned === chosen) {
            held.target = held.pinned;
            held.attempts = 1;
        }
        held.pinned = null;

        const current = player.getPlaybackQuality();

        if (current === chosen) {
            held.attempts = 0;
            held.settledOn = chosen;
            return;
        }

        askFor(player, chosen, current);
    };

    // The one point early enough to be sure the first segment fetched is the right one. A rung the
    // video turns out not to offer is corrected down once the ladder arrives, before formats are
    // chosen, so guessing wrong here costs nothing.
    const pinNamed = (player) => {
        const named = NAMED[parseInt(configRead(QUALITY), 10)];
        if (!named) return;

        try {
            player.setPlaybackQualityRange(named, named);
            held.pinned = named;
        } catch (e) {
            console.warn('[tube] could not pin the preferred quality:', e);
        }
    };

    const adopt = (player) => {
        if (player === held.player) return;

        held.player = player;
        player.addEventListener('onStateChange', tick);
        pinNamed(player);
        forget();
        tick();
    };

    const attachToPlayer = () => whenPlayer('preferred quality', adopt);

    function tick() {
        if (!held.player) return;
        if (held.player.isConnected === false) {
            held.player = null;
            waitFor(() => document.querySelector(PLAYER), adopt);
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

        // So the next video opens on the new setting rather than being corrected into it.
        seedPreferredQuality();
        if (configRead(QUALITY) === 'auto') liftCeiling();
        forget();
        tick();
    });

    // The three second heartbeat is far too coarse to land inside the window between the response
    // arriving and the player having read it, so the response opens a burst of its own. It is only
    // read — the rungs on offer are left alone, so the quality menu keeps them all.
    const settleQuickly = (response) => {
        const videoId = response.videoDetails?.videoId;

        stop('quality settling');
        until('quality settling', SETTLING_EVERY, () => {
            tick();
            if (held.lastVideoId === videoId && held.settledOn !== null) stop('quality settling');
        }, SETTLING_FOR);
    };

    onResponse('preferred quality', ['streamingData'], settleQuickly);

    every('quality heartbeat', CHECK_INTERVAL, tick);
    attachToPlayer();
}

// Seeded before the watcher starts, and renewed on navigation for the same reason it is written
// unconditionally: the player overwrites the estimate with its own as each video ends.
if (typeof window !== 'undefined') {
    seedPreferredQuality();
    window.addEventListener('hashchange', seedPreferredQuality);

    watchPreferredQuality();
}
