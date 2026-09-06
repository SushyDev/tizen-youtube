import sha256 from '../tiny-sha256.js';
import { SEGMENTS as barTypes } from './segments.js';
import { waitFor } from '../utils/waitFor.js';
import { configRead } from '../config.js';
import { showToast } from '../ui/ytUI.js';

const sponsorblockAPI = 'https://sponsor.ajay.app/api';

const SLIDER = 'div[idomkey="slider"]';
const PROGRESS_BAR = 'ytlr-redux-connect-ytlr-progress-bar';

// poi_highlight is asked for but never skipped: it marks a point, it does not cover a stretch.
const ASKED_FOR = [
    'sponsor', 'intro', 'outro', 'interaction',
    'selfpromo', 'preview', 'filler', 'music_offtopic', 'poi_highlight'
];

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

const REPEAT_WINDOW = 1000;
const SLIDER_EVERY = 500;
const WAIT_EVERY = 100;

function sponsorBlockFor(videoID) {
    // One record of everything that changes, so the handlers below can stay pure functions of it.
    const held = {
        video: null,
        active: true,
        segments: null,
        slider: null,
        segmentsoverlay: null,
        observer: null,
        stopWaitingForVideo: null,
        nextSkipTimeout: null,
        sliderInterval: null,
        onScheduleSkip: null,
        onDurationChange: null,
        skippable: [],
        manualOnly: [],
        alreadySkipped: new Map()
    };

    const skippableCategories = () => SKIPPABLE
        .filter(([setting]) => configRead(setting))
        .map(([, category]) => category);

    // -- the overlay ------------------------------------------------------------------------------

    const barFor = (segment) => barTypes[segment.category] || { color: 'blue', opacity: 0.7 };

    const segmentElement = (segment, videoDuration) => {
        const [start, end] = segment.segment;
        const bar = barFor(segment);

        const leftPercent = videoDuration ? (100.0 * start) / videoDuration : 0;
        const widthPercent = videoDuration ? (100.0 * (end - start)) / videoDuration : 0;

        const element = document.createElement('div');
        element.style.setProperty('background-color', bar.color, 'important');
        element.style.setProperty('opacity', bar.opacity, 'important');
        element.style.setProperty('height', '100%', 'important');
        element.style.setProperty('width', `${segment.category === 'poi_highlight' ? 1 : widthPercent}%`, 'important');
        element.style.setProperty('left', `${leftPercent}%`, 'important');
        element.style.setProperty('position', 'absolute', 'important');

        return element;
    };

    const styleOverlayLike = (slider) => {
        const rect = slider.getBoundingClientRect();
        if (slider.classList.contains('ytLrProgressBarSlider')) return;

        Array.from(slider.classList).forEach((name) => held.segmentsoverlay.classList.add(name));
        held.segmentsoverlay.style.setProperty('height', `${rect.height}px`, 'important');
        held.segmentsoverlay.style.setProperty('bottom', `${rect.bottom - rect.top}px`, 'important');
    };

    const watchOverlay = () => new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            const removed = Array.from(mutation.removedNodes || []);
            if (removed.indexOf(held.segmentsoverlay) !== -1 && held.slider) {
                held.slider.appendChild(held.segmentsoverlay);
            }

            // This runs on every subtree change, and the bar is not always mounted.
            const bar = document.querySelector('ytlr-progress-bar');
            const hidden = !!bar && bar.getAttribute('hybridnavfocusable') === 'false';

            held.segmentsoverlay.style.setProperty('display', hidden ? 'none' : 'block', 'important');
        });
    });

    const buildOverlay = () => {
        if (held.segmentsoverlay) return undefined;
        if (!held.video || !held.video.duration) return undefined;

        const slider = document.querySelector(SLIDER);
        if (!slider) return waitFor(() => document.querySelector(SLIDER), buildOverlay, { everyMs: WAIT_EVERY });

        held.segmentsoverlay = document.createElement('div');
        held.segmentsoverlay.classList.add('ytLrProgressBarSlider', 'ytLrProgressBarSliderRectangularProgressBar');
        held.segmentsoverlay.style.setProperty('z-index', '10', 'important');
        held.segmentsoverlay.style.setProperty('background-color', 'rgba(0, 0, 0, 0)', 'important');
        held.segmentsoverlay.style.setProperty('width', '72rem', 'important');
        held.segmentsoverlay.style.setProperty('left', '4rem', 'important');

        styleOverlayLike(slider);

        held.segments.forEach((segment) => {
            held.segmentsoverlay.appendChild(segmentElement(segment, held.video.duration));
        });

        held.observer = watchOverlay();

        held.sliderInterval = setInterval(() => {
            held.slider = document.querySelector(PROGRESS_BAR);
            if (!held.slider) return;

            clearInterval(held.sliderInterval);
            held.sliderInterval = null;

            held.observer.observe(held.slider, { childList: true, subtree: true });
            held.slider.appendChild(held.segmentsoverlay);
        }, SLIDER_EVERY);

        return undefined;
    };

    // -- skipping ---------------------------------------------------------------------------------

    // A segment the viewer keeps landing back inside is one they meant to watch, so after a repeat
    // inside a second it is announced once and then left alone.
    const skippedTooOften = (segment, skipName) => {
        const before = held.alreadySkipped.get(segment.UUID);

        if (!before) {
            held.alreadySkipped.set(segment.UUID, {
                count: 1, firstSkipped: Date.now(), lastSkipped: Date.now(), hasShownToast: false
            });
            return false;
        }

        const seen = Object.assign({}, before, { count: before.count + 1, lastSkipped: Date.now() });
        held.alreadySkipped.set(segment.UUID, seen);

        if (seen.lastSkipped - seen.firstSkipped >= REPEAT_WINDOW) return false;

        if (!seen.hasShownToast) {
            if (configRead('enableSponsorBlockToasts')) {
                showToast('SponsorBlock', `Not skipping ${skipName} (was skipped ${seen.count} times)`);
            }

            held.alreadySkipped.set(segment.UUID, Object.assign({}, seen, { hasShownToast: true }));
        }

        return true;
    };

    const skipOver = (segment) => {
        const [, end] = segment.segment;
        const skipName = barTypes[segment.category]?.name || segment.category;

        if (held.manualOnly.includes(segment.category)) return;
        if (skippedTooOften(segment, skipName)) return;

        if (configRead('enableSponsorBlockToasts')) showToast('SponsorBlock', `Skipping ${skipName}`);

        held.video.currentTime = held.video.duration - end < 1 ? end - 1 : end;
        scheduleSkip();
    };

    function scheduleSkip() {
        clearTimeout(held.nextSkipTimeout);
        held.nextSkipTimeout = null;

        if (!held.active || held.video.paused) return;

        const ahead = held.segments
            .filter((seg) => seg.segment[0] > held.video.currentTime - 0.3
                && seg.segment[1] > held.video.currentTime - 0.3)
            .sort((one, two) => one.segment[0] - two.segment[0]);

        if (!ahead.length) return;

        const [segment] = ahead;
        const [start] = segment.segment;

        held.nextSkipTimeout = setTimeout(() => {
            if (held.video.paused) return;
            if (!held.skippable.includes(segment.category)) return;

            skipOver(segment);
        }, (start - held.video.currentTime) * 1000);
    }

    // -- the video ---------------------------------------------------------------------------------

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

        held.video.addEventListener('play', held.onScheduleSkip);
        held.video.addEventListener('pause', held.onScheduleSkip);
        held.video.addEventListener('timeupdate', held.onScheduleSkip);
        held.video.addEventListener('durationchange', held.onDurationChange);
    }

    const init = async () => {
        const videoHash = sha256(videoID).substring(0, 4);
        const asked = encodeURIComponent(JSON.stringify(ASKED_FOR));
        const response = await fetch(`${sponsorblockAPI}/skipSegments/${videoHash}?categories=${asked}`);
        const results = await response.json();

        const result = results.find((entry) => entry.videoID === videoID);
        if (!result || !result.segments || !result.segments.length) return;

        held.segments = result.segments;
        held.manualOnly = configRead('sponsorBlockManualSkips');
        held.skippable = skippableCategories();

        // The overlay sits on the progress bar, which the old layout positions differently.
        held.onScheduleSkip = () => {
            const sliderRect = document.querySelector(SLIDER)?.getBoundingClientRect();
            const isOldUI = !document.querySelector('div[idomkey="Metadata-Section"]');

            if (isOldUI && sliderRect && held.segmentsoverlay) {
                held.segmentsoverlay.style.setProperty('top', `${sliderRect.top}px`, 'important');
            }

            scheduleSkip();
        };

        held.onDurationChange = () => buildOverlay();

        attachVideo();
        buildOverlay();
    };

    const destroy = () => {
        held.active = false;

        clearTimeout(held.nextSkipTimeout);
        held.nextSkipTimeout = null;

        if (held.stopWaitingForVideo) held.stopWaitingForVideo();
        held.stopWaitingForVideo = null;

        clearInterval(held.sliderInterval);
        held.sliderInterval = null;

        if (held.observer) held.observer.disconnect();
        held.observer = null;

        if (held.segmentsoverlay) held.segmentsoverlay.remove();
        held.segmentsoverlay = null;

        if (held.video) {
            held.video.removeEventListener('play', held.onScheduleSkip);
            held.video.removeEventListener('pause', held.onScheduleSkip);
            held.video.removeEventListener('timeupdate', held.onScheduleSkip);
            held.video.removeEventListener('durationchange', held.onDurationChange);
        }

        held.alreadySkipped.clear();
    };

    // segments is read from adblock.js and is filled in after the fetch, so it has to stay live.
    return {
        videoID,
        get segments() { return held.segments; },
        init,
        destroy
    };
}

window.sponsorblock = null;

window.addEventListener('hashchange', () => {
    const newURL = new URL(location.hash.substring(1), location.href);
    const videoID = newURL.search.replace('?v=', '').split('&')[0];

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
