import { PLAYER, configChangeEmitter, configRead, every, onResponse, until, waitFor, whenPlayer } from '../../framework/index.js';
import { NAMED, chooseQuality } from './qualityLadder.js';
import { rungToAsk } from './qualityAsk.js';
import { QUALITY, liftCeiling, seedPreferredQuality } from './qualitySeed.js';

// Every playback starts on Auto and must be told its rung.

const CHECK_INTERVAL = 3000;

const SETTLING_EVERY = 250;
const SETTLING_FOR = 8000;

function watchPreferredQuality() {
    // Keyed on the cpn: a Next passes through a copy of the playback data that is then discarded.
    const held = { player: null, playback: null, asked: null };

    // Forcing 2160p on a Short spends the link on a video that was never going to show it.
    const isShorts = (player) => {
        try {
            return Object.values(player.getVideoStats()).some((value) => value === 'shortspage');
        } catch (e) {
            return false;
        }
    };

    // A preview on a shelf plays in this same player, which YouTube caps at 480p.
    const onWatchPage = () => String(location.hash).indexOf('#/watch') === 0;

    const applyPreference = (player) => {
        const data = player.getVideoData?.() || {};
        const playback = data.cpn || data.video_id;

        if (playback !== held.playback) {
            held.playback = playback;
            held.asked = null;
        }

        const preference = configRead(QUALITY);
        if (!preference || preference === 'auto') return;
        if (!onWatchPage() || isShorts(player)) return;

        const wanted = rungToAsk({
            chosen: chooseQuality(preference, player.getAvailableQualityData()),
            preferred: player.getPreferredQuality?.(),
            asked: held.asked
        });
        if (!wanted) return;

        player.setPlaybackQualityRange(wanted, wanted);
        held.asked = wanted;
    };

    // Early enough that the first segment fetched is the right one, and a rung the video does not
    // offer is corrected down once the ladder arrives.
    const pinNamed = (player) => {
        const named = NAMED[parseInt(configRead(QUALITY), 10)];
        if (!named) return;

        try {
            player.setPlaybackQualityRange(named, named);
        } catch (e) {
            console.warn('[tube] could not pin the preferred quality:', e);
        }
    };

    const adopt = (player) => {
        if (player === held.player) return;

        held.player = player;
        player.addEventListener('onStateChange', tick);
        pinNamed(player);
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
        tick();
    });

    // The heartbeat is too coarse to land between the response arriving and the player reading it,
    // and the burst runs its full length because the first playback after a Next may be discarded.
    const settleQuickly = () => until('quality settling', SETTLING_EVERY, tick, SETTLING_FOR);

    onResponse('preferred quality', ['streamingData'], settleQuickly);

    every('quality heartbeat', CHECK_INTERVAL, tick);
    attachToPlayer();
}

if (typeof window !== 'undefined') {
    seedPreferredQuality();
    window.addEventListener('hashchange', seedPreferredQuality);

    watchPreferredQuality();
}
