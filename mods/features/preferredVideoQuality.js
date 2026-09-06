import { configRead, configChangeEmitter } from '../config.js';
import { waitFor } from '../utils/waitFor.js';
import { onResponse } from '../youtube/json.js';
import { chooseQuality, shouldAsk } from './quality.js';

const PLAYER = '.html5-video-player';
const QUALITY = 'preferredVideoQuality';

const CHECK_INTERVAL = 3000;
const ATTACH_EVERY = 250;

// A player response means a ladder is about to exist. Three seconds is far too coarse a heartbeat
// to catch that before the first frame, so it is met with a short burst of close-together looks.
const SETTLING_EVERY = 250;
const SETTLING_FOR = 8000;

// Asking restarts the stream, so a rung the player will not take is dropped rather than pressed.
// Two asks: the first before the first frame, where it is free, and one to correct it if the player
// was not ready to hear it that early. Never a third — three asks five seconds apart is what earned
// this feature its reputation for wedging playback, and they only happened because the settle never
// landed. Measured in the container, one ask is normally the whole story: on a video sitting at
// hd1440, a single setPlaybackQualityRange('hd2160') read back as hd2160 within five seconds.
const LIMITS = { maxAttempts: 2, retryDelay: 5000 };

const RESTART_JUMP = 2;

function watchPreferredQuality() {
    const held = {
        player: null,
        lastVideoId: null,
        lastTime: 0,
        target: null,
        attempts: 0,
        askedAt: 0,
        // Without this, a quality chosen from the player's own menu is overridden on the next tick.
        settled: false,
        settledOn: null,
        settling: null
    };

    const forget = () => {
        held.target = null;
        held.attempts = 0;
        held.askedAt = 0;
        held.settled = false;
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

        // Deliberately not waiting for playback. `getAvailableQualityData()` reads off the player
        // response rather than off playback state, so the rungs are known before the first frame is
        // decoded — and asking then costs nothing, because there is no stream yet to restart.
        // Waiting for isPlaying is what turned this into a visible switch partway into a video, and
        // an empty ladder already answers for itself below.
        const chosen = chooseQuality(preference, player.getAvailableQualityData());
        if (!chosen) return;

        // The ladder is not complete the moment playback starts, so settling on what was on offer
        // then would pin the video under a rung that appeared a second later. A different answer
        // reopens the decision; the same answer leaves a hand-picked quality where it was put.
        if (held.settled && held.settledOn === chosen) return;
        held.settled = false;

        const current = player.getPlaybackQuality();

        if (current === chosen) {
            held.attempts = 0;
            held.settled = true;
            held.settledOn = chosen;
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
        { everyMs: ATTACH_EVERY }
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

    // The earliest the rungs can be known is the moment the player response is parsed — earlier
    // than any state the player element reports, and earlier than the heartbeat below would notice.
    // Seeing that response is not the same as the player having ingested it, though, so it opens a
    // brief burst of close-together ticks instead of asking there and then. That closes the gap
    // between the ladder existing and the ask, which is the whole difference between setting the
    // quality and switching it. Reading the response only; the rungs on offer are left alone.
    const settleQuickly = () => {
        clearInterval(held.settling);

        const until = Date.now() + SETTLING_FOR;

        held.settling = setInterval(() => {
            tick();
            if (!held.settled && Date.now() <= until) return;

            clearInterval(held.settling);
            held.settling = null;
        }, SETTLING_EVERY);
    };

    onResponse('preferred quality', ['streamingData'], settleQuickly);

    setInterval(tick, CHECK_INTERVAL);
    attachToPlayer();
}

// This was switched off inside the container on the belief that its player does not report the rung
// back under the name we asked for, so the retry never settled and the third ask wedged playback.
// Measured on the set instead: it reports back exactly what it was given. On a video sitting at
// hd1440 with preferred=auto, one ask for hd2160 came back as hd2160 within five seconds and
// playback carried on. The unbounded retry was the fault, and it is two asks at most now.
//
// Note the video element is no use as the check: it reads 3840x2160 while the player is on hd1440,
// because it reports the size it presents at and not the size it decoded.
if (typeof window !== 'undefined') watchPreferredQuality();
