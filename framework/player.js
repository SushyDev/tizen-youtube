// The player, found once.
//
// Nine features waited for it separately — six through waitFor, one through a hand-rolled retry
// with no give-up, one through a document-wide MutationObserver, one by re-querying on every tick
// — and they did not agree on what they were waiting for: `video`, `.html5-video-player`, and
// `#movie_player, .html5-video-player`. The union is the right answer, because it is what the
// widest of them already used.

import { waitFor } from './waitFor.js';

const PLAYER = '#movie_player, .html5-video-player';

const held = { player: null, video: null, watching: false };
const wanted = { player: [], video: [] };

const findPlayer = () => document.querySelector(PLAYER);
const findVideo = () => document.querySelector('video');

const say = (entry, subject) => {
    try {
        entry.run(subject);
    } catch (failure) {
        console.error(`[player:${entry.name}] failed:`, failure);
    }
};

const tell = (bucket, subject) => wanted[bucket].forEach((entry) => say(entry, subject));

// The page swaps both elements out without ending playback, so this re-arms rather than resolving
// once. preferredVideoQuality hand-rolled exactly this and left the old listener attached.
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

    // waitFor gives up, which is the point: a page that never grows a player stops costing
    // anything. A navigation re-arms it, because that is when a new one appears.
    const look = () => waitFor(settle, () => undefined, { everyMs: 250 });

    look();
    window.addEventListener('hashchange', look);
};

const whenPlayer = (name, onPlayer) => {
    watch();

    const entry = { name, run: onPlayer };
    wanted.player.push(entry);

    // A late subscriber is told at once about a player that is already there, and only it is.
    if (held.player) say(entry, held.player);

    return () => { wanted.player = wanted.player.filter((one) => one !== entry); };
};

const whenVideo = (name, onVideo) => {
    watch();

    const entry = { name, run: onVideo };
    wanted.video.push(entry);
    if (held.video) say(entry, held.video);

    return () => { wanted.video = wanted.video.filter((one) => one !== entry); };
};

// For code already inside a handler, where the waiting has happened.
const player = () => (held.player && held.player.isConnected === false ? null : held.player);
const video = () => (held.video && held.video.isConnected === false ? null : held.video);

export { whenPlayer, whenVideo, player, video, PLAYER };
