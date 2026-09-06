import { configRead, configChangeEmitter } from '../config.js';
import { waitFor } from '../utils/waitFor.js';
import { onResponse } from '../youtube/json.js';
import { chooseQuality, shouldAsk } from './quality.js';

const PLAYER = '.html5-video-player';
const QUALITY = 'preferredVideoQuality';

const CHECK_INTERVAL = 3000;
const ATTACH_EVERY = 250;

const SETTLING_EVERY = 250;
const SETTLING_FOR = 8000;

// Asking restarts a running stream, so a rung the player will not take is dropped rather than
// pressed: one ask before the first frame, one to correct it, and never a third.
const LIMITS = { maxAttempts: 2, retryDelay: 5000 };

const RESTART_JUMP = 2;

// YouTube's own keys, written in YouTube's own envelope: the value is a JSON string under `data`,
// with `creation` and `expiration` beside it. The estimate is read into the ABR policy at start-up
// and is what decides the rung it opens on. The ceiling is only the top of that range, not a
// target, so it cannot do that job by itself.
const BANDWIDTH_KEY = 'yt-player-bandwidth';
const CEILING_KEY = 'yt-player-quality';

// Bytes per second. A named rung is pinned below, so its estimate need only be plausible. `highest`
// has nothing else forcing its hand, so it is told the link is larger than any stream could use —
// ABR measures the truth within a segment or two either way.
const SEEDED_BYTERATE = 6250000;
const UNCAPPED_BYTERATE = 1250000000;
const REMEMBERED_FOR = 2592000;

// The player's own names for the rungs, so a named setting can be acted on without the ladder.
const NAMED = {
    2160: 'hd2160', 1440: 'hd1440', 1080: 'hd1080', 720: 'hd720',
    480: 'large', 360: 'medium', 240: 'small', 144: 'tiny'
};

const remember = (key, value) => {
    const now = Date.now();

    window.localStorage.setItem(key, JSON.stringify({
        data: JSON.stringify(value),
        expiration: now + REMEMBERED_FOR * 1000,
        creation: now
    }));
};

const openAtPreferredQuality = () => {
    const preference = configRead(QUALITY);
    if (!preference || preference === 'auto') return;

    try {
        // Written every time: the player saves its own measurement back over this key as each video
        // ends, so a value written once would decide the first video and nothing after it.
        remember(BANDWIDTH_KEY, {
            byterate: preference === 'highest' ? UNCAPPED_BYTERATE : SEEDED_BYTERATE
        });

        // `highest` wants no ceiling, and a stored zero is how the player spells that.
        const height = parseInt(preference, 10) || 0;
        remember(CEILING_KEY, { quality: height, previousQuality: height });
    } catch (e) {
        // Storage is not something to fail a page over.
    }
};

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

        // Not waiting for playback: getAvailableQualityData() reads off the player response, so the
        // rungs are known before the first frame and asking then costs no restart.
        const chosen = chooseQuality(preference, player.getAvailableQualityData());
        if (!chosen) return;

        // The ladder is not complete the moment playback starts, so a settled choice is reopened
        // when the answer changes — and left alone when it does not, so a hand-picked rung survives.
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

    // A named rung needs no ladder, so it can be pinned before a video is loaded at all — the only
    // point early enough to be sure the first segment fetched is the right one. `highest` cannot:
    // which rung is highest is not known until the response lists them. A rung the video turns out
    // not to offer is corrected down once the ladder arrives, before formats are chosen.
    const pinNamed = (player) => {
        const named = NAMED[parseInt(configRead(QUALITY), 10)];
        if (!named) return;

        try {
            player.setPlaybackQualityRange(named, named);
            held.target = named;
            held.attempts = 1;
            held.askedAt = Date.now();
        } catch (e) {
            console.warn('[tube] could not pin the preferred quality:', e);
        }
    };

    const attachToPlayer = () => waitFor(
        () => document.querySelector(PLAYER),
        (player) => {
            held.player = player;
            player.addEventListener('onStateChange', tick);
            pinNamed(player);
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

        // So the next video opens on the new setting rather than being corrected into it.
        openAtPreferredQuality();
        forget();
        tick();
    });

    // The rungs cannot be known before the response that lists them. Seeing it is not the same as
    // the player having ingested it, so it opens a burst of close-together looks rather than an ask
    // there and then; the three second heartbeat is far too coarse to land inside that window. The
    // response is only read — the rungs on offer are left alone, so the quality menu keeps them all.
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

// Seeded before the watcher starts: it has to be in storage before the player reads it, which our
// tag manages because it is parser-inserted while kabuki's own script is appended to the body and
// therefore async. Renewed on navigation for the same reason it is written unconditionally.
if (typeof window !== 'undefined') {
    openAtPreferredQuality();
    window.addEventListener('hashchange', openAtPreferredQuality);

    watchPreferredQuality();
}
