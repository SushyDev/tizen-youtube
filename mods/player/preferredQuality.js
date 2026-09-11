import { PLAYER, configChangeEmitter, configRead, every, onResponse, stop, until, waitFor, whenPlayer } from '../../framework/index.js';
import { chooseQuality, shouldAsk } from './quality.js';

const QUALITY = 'preferredVideoQuality';

const CHECK_INTERVAL = 3000;

const SETTLING_EVERY = 250;
const SETTLING_FOR = 8000;

// Asking restarts the stream, so a rung the player will not take is dropped after a few tries.
const LIMITS = { maxAttempts: 2, retryDelay: 5000 };

const RESTART_JUMP = 2;

const BANDWIDTH_KEY = 'yt-player-bandwidth';
const CEILING_KEY = 'yt-player-quality';

// `highest` claims more bandwidth than any stream needs, so ABR opens at the top and re-measures.
const SEEDED_BYTES_PER_SECOND = 6250000;
const UNCAPPED_BYTES_PER_SECOND = 1250000000;
const REMEMBERED_FOR_MS = 30 * 24 * 60 * 60 * 1000;

// The player's own names for the rungs, so a named setting can be acted on without the ladder.
const NAMED = {
    2160: 'hd2160', 1440: 'hd1440', 1080: 'hd1080', 720: 'hd720',
    480: 'large', 360: 'medium', 240: 'small', 144: 'tiny'
};

const remember = (key, value) => {
    const now = Date.now();

    window.localStorage.setItem(key, JSON.stringify({
        data: JSON.stringify(value),
        expiration: now + REMEMBERED_FOR_MS,
        creation: now
    }));
};

const openAtPreferredQuality = () => {
    const preference = configRead(QUALITY);
    if (!preference || preference === 'auto') return;

    try {
        // The player overwrites this key with its own measurement as each video ends.
        remember(BANDWIDTH_KEY, {
            byterate: preference === 'highest' ? UNCAPPED_BYTES_PER_SECOND : SEEDED_BYTES_PER_SECOND
        });

        // `highest` wants no ceiling, and a stored zero is how the player spells that.
        const height = parseInt(preference, 10) || 0;
        remember(CEILING_KEY, { quality: height, previousQuality: height });
    } catch (e) {
        console.warn('[tube] could not seed the preferred quality:', e);
    }
};

const liftCeiling = () => {
    try {
        remember(CEILING_KEY, { quality: 0, previousQuality: 0 });
    } catch (e) {
        console.warn('[tube] could not lift the quality ceiling:', e);
    }
};

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
        settledOn: null,
        settling: null
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
        openAtPreferredQuality();
        if (configRead(QUALITY) === 'auto') liftCeiling();
        forget();
        tick();
    });

    // The player ingests a response some time after it is parsed, so the choice is polled closely
    // until it settles.
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

// Must run before kabuki's script reads storage: our tag is parser-inserted, kabuki's is appended
// and async.
if (typeof window !== 'undefined') {
    openAtPreferredQuality();
    window.addEventListener('hashchange', openAtPreferredQuality);

    watchPreferredQuality();
}
