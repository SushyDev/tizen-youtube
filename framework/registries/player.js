import { until, stop } from './schedule.js';
import { report } from './journal.js';

const PLAYER = '#movie_player, .html5-video-player';

const held = { player: null, video: null, watching: false };
const wanted = { player: [], video: [] };

const findPlayer = () => document.querySelector(PLAYER);
const findVideo = () => document.querySelector('video');

const say = (entry, subject) => {
    try {
        entry.run(subject);
    } catch (failure) {
        report(`player:${entry.name}`, 'failed', failure);
    }
};

const tell = (bucket, subject) => wanted[bucket].forEach((entry) => say(entry, subject));

// The page swaps both elements without ending playback, so subscribers are told again.
const settle = () => {
    const player = findPlayer();
    const video = findVideo();

    if (player && player !== held.player) {
        held.player = player;
        tell('player', player);
    }

    if (video && video !== held.video) {
        held.video = video;
        tell('video', video);
    }

    return !!(player && video);
};

const watch = () => {
    if (held.watching) return;
    held.watching = true;

    // until() gives up, so a page that never grows a player stops costing anything, and a
    // navigation re-arms it.
    const look = () => {
        if (settle()) return;
        until('player watch', 250, () => { if (settle()) stop('player watch'); }, 60000);
    };

    look();
    window.addEventListener('hashchange', look);
};

const whenPlayer = (name, onPlayer) => {
    watch();

    const entry = { name, run: onPlayer };
    wanted.player = wanted.player.concat([entry]);

    // A late subscriber is told at once about a player that is already there.
    if (held.player) say(entry, held.player);

    return () => { wanted.player = wanted.player.filter((one) => one !== entry); };
};

const whenVideo = (name, onVideo) => {
    watch();

    const entry = { name, run: onVideo };
    wanted.video = wanted.video.concat([entry]);
    if (held.video) say(entry, held.video);

    return () => { wanted.video = wanted.video.filter((one) => one !== entry); };
};

const player = () => (held.player && held.player.isConnected === false ? null : held.player);
const video = () => (held.video && held.video.isConnected === false ? null : held.video);

export { whenPlayer, whenVideo, player, video, PLAYER };
