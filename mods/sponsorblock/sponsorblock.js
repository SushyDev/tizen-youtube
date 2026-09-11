import { configRead, waitFor } from '../../framework/index.js';
import { segmentsFor } from './segmentApi.js';
import { segmentOverlay } from './segmentOverlay.js';
import { autoSkipper } from './autoSkip.js';

// One video's SponsorBlock session, torn down on navigation.

const WAIT_EVERY = 100;

const SKIPPABLE = [
    ['enableSponsorBlockSponsor', 'sponsor'],
    ['enableSponsorBlockIntro', 'intro'],
    ['enableSponsorBlockOutro', 'outro'],
    ['enableSponsorBlockInteraction', 'interaction'],
    ['enableSponsorBlockSelfPromo', 'selfpromo'],
    ['enableSponsorBlockPreview', 'preview'],
    ['enableSponsorBlockFiller', 'filler'],
    ['enableSponsorBlockMusicOfftopic', 'music_offtopic']
];

const skippableCategories = () => SKIPPABLE
    .filter(([setting]) => configRead(setting))
    .map(([, category]) => category);

const sponsorBlockFor = (videoID) => {
    const held = {
        gone: false,
        video: null,
        segments: [],
        overlay: null,
        skipper: null,
        stopWaitingForVideo: null,
        onTick: null,
        onDurationChange: null
    };

    // The video element is replaced across navigations, so this is re-entrant: it cancels its own
    // outstanding wait before starting another.
    function attachVideo() {
        if (held.stopWaitingForVideo) held.stopWaitingForVideo();
        held.stopWaitingForVideo = null;

        held.video = document.querySelector('video');

        if (!held.video) {
            held.stopWaitingForVideo = waitFor(
                () => document.querySelector('video'), attachVideo, { everyMs: WAIT_EVERY }
            );
            return;
        }

        held.overlay.watch(held.video);
        held.skipper.watch(held.video);

        held.video.addEventListener('play', held.onTick);
        held.video.addEventListener('pause', held.onTick);
        held.video.addEventListener('timeupdate', held.onTick);
        held.video.addEventListener('durationchange', held.onDurationChange);
    }

    const init = async () => {
        const segments = await segmentsFor(videoID);
        if (held.gone || !segments.length) return;

        held.segments = segments;
        held.overlay = segmentOverlay(segments);
        held.skipper = autoSkipper(segments, skippableCategories(), configRead('sponsorBlockManualSkips'));

        held.onTick = () => held.skipper.schedule();

        // The duration is what every bar's width is a fraction of, so it is also the moment the
        // overlay becomes drawable — including when the video element arrived after this did.
        held.onDurationChange = () => held.overlay.show();

        attachVideo();
        held.overlay.show();
    };

    const destroy = () => {
        held.gone = true;

        if (held.stopWaitingForVideo) held.stopWaitingForVideo();
        held.stopWaitingForVideo = null;

        if (held.skipper) held.skipper.finish();
        if (held.overlay) held.overlay.remove();

        if (held.video) {
            held.video.removeEventListener('play', held.onTick);
            held.video.removeEventListener('pause', held.onTick);
            held.video.removeEventListener('timeupdate', held.onTick);
            held.video.removeEventListener('durationchange', held.onDurationChange);
        }

        held.video = null;
    };

    // A getter, because the segments arrive after the session does and the parts of SponsorBlock
    // that dress the player ask for them whenever the player asks them for a button.
    return {
        videoID,
        get segments() { return held.segments; },
        init,
        destroy
    };
};

window.sponsorblock = null;

// Parsed by hand: Cobalt's URL has no searchParams and no URLSearchParams global.
const videoIdIn = (hash) => {
    const at = String(hash || '').indexOf('?');
    if (at === -1) return null;

    const found = /(?:^|&)v=([^&]*)/.exec(hash.slice(at + 1));
    if (!found) return null;

    try {
        return decodeURIComponent(found[1]);
    } catch (e) {
        return found[1];
    }
};

const videoOnScreen = () => videoIdIn(location.hash);

window.addEventListener('hashchange', () => {
    const videoID = videoOnScreen();

    if (!videoID) return;
    if (window.sponsorblock && window.sponsorblock.videoID === videoID) return;

    if (window.sponsorblock) {
        try {
            window.sponsorblock.destroy();
        } catch (err) {
            console.warn('window.sponsorblock.destroy() failed!', err);
        }

        window.sponsorblock = null;
    }

    if (!configRead('enableSponsorBlock')) return;

    window.sponsorblock = sponsorBlockFor(videoID);
    window.sponsorblock.init();
}, false);

const segmentsForVideo = () => (window.sponsorblock && window.sponsorblock.segments) || [];

export { segmentsForVideo, videoIdIn };
