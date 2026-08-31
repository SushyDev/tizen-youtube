import sha256 from '../tiny-sha256.js';
import { configRead } from '../config.js';
import { showToast } from '../ui/ytUI.js';

// Copied from https://github.com/ajayyy/SponsorBlock/blob/da1a535de784540ee10166a75a3eb8537073838c/src/config.ts#L113-L134
const barTypes = {
  sponsor: {
    color: '#00d400',
    opacity: '0.7',
    name: 'sponsored segment' || 'sponsored segment'
  },
  intro: {
    color: '#00ffff',
    opacity: '0.7',
    name: 'intro' || 'intro'
  },
  outro: {
    color: '#0202ed',
    opacity: '0.7',
    name: 'outro' || 'outro'
  },
  interaction: {
    color: '#cc00ff',
    opacity: '0.7',
    name: 'interaction reminder' || 'interaction reminder'
  },
  selfpromo: {
    color: '#ffff00',
    opacity: '0.7',
    name: 'self-promotion' || 'self-promotion'
  },
  preview: {
    color: '#008fd6',
    opacity: '0.7',
    name: 'recap or preview' || 'recap or preview'
  },
  filler: {
    color: "#7300FF",
    opacity: "0.9",
    name: 'tangents' || 'tangents'
  },
  music_offtopic: {
    color: '#ff9900',
    opacity: '0.7',
    name: 'non-music part' || 'non-music part'
  },
  poi_highlight: {
    color: '#9b044c',
    opacity: '0.7',
    name: 'highlight' || 'highlight'
  }
};

const sponsorblockAPI = 'https://sponsor.ajay.app/api';

class SponsorBlockHandler {
  video = null;
  active = true;

  attachVideoTimeout = null;
  nextSkipTimeout = null;
  sliderInterval = null;

  observer = null;
  overlayFrame = null;
  isOldUI = undefined;
  scheduleSkipHandler = null;
  durationChangeHandler = null;
  segments = null;
  skippableCategories = [];
  manualSkippableCategories = [];
  skippedCategories = new Map();

  constructor(videoID) {
    this.videoID = videoID;
  }

  async init() {
    const videoHash = sha256(this.videoID).substring(0, 4);
    const categories = [
      'sponsor',
      'intro',
      'outro',
      'interaction',
      'selfpromo',
      'preview',
      'filler',
      'music_offtopic',
      'poi_highlight'
    ];
    const resp = await fetch(
      `${sponsorblockAPI}/skipSegments/${videoHash}?categories=${encodeURIComponent(
        JSON.stringify(categories)
      )}`
    );
    const results = await resp.json();

    const result = results.find((v) => v.videoID === this.videoID);
    console.info(this.videoID, 'Got it:', result);

    if (!result || !result.segments || !result.segments.length) {
      console.info(this.videoID, 'No segments found.');
      return;
    }

    this.segments = result.segments;
    this.manualSkippableCategories = configRead('sponsorBlockManualSkips');
    this.skippableCategories = this.getSkippableCategories();

    // Repositioning the overlay used to happen here, which meant two document-wide
    // queries plus a getBoundingClientRect — a forced synchronous layout — four times a
    // second on the same thread that feeds the decoder. It belongs on the progress
    // bar's own observer, which only wakes when the bar actually changes.
    this.scheduleSkipHandler = () => this.scheduleSkip();
    this.durationChangeHandler = () => this.buildOverlay();

    this.attachVideo();
    this.buildOverlay();
  }

  getSkippableCategories() {
    const skippableCategories = [];
    if (configRead('enableSponsorBlockSponsor')) {
      skippableCategories.push('sponsor');
    }
    if (configRead('enableSponsorBlockIntro')) {
      skippableCategories.push('intro');
    }
    if (configRead('enableSponsorBlockOutro')) {
      skippableCategories.push('outro');
    }
    if (configRead('enableSponsorBlockInteraction')) {
      skippableCategories.push('interaction');
    }
    if (configRead('enableSponsorBlockSelfPromo')) {
      skippableCategories.push('selfpromo');
    }
    if (configRead('enableSponsorBlockPreview')) {
      skippableCategories.push('preview');
    }
    if (configRead('enableSponsorBlockFiller')) {
      skippableCategories.push('filler');
    }
    if (configRead('enableSponsorBlockMusicOfftopic')) {
      skippableCategories.push('music_offtopic');
    }
    return skippableCategories;
  }

  attachVideo() {
    clearTimeout(this.attachVideoTimeout);
    this.attachVideoTimeout = null;

    this.video = document.querySelector('video');
    if (!this.video) {
      console.info(this.videoID, 'No video yet...');
      this.attachVideoTimeout = setTimeout(() => this.attachVideo(), 100);
      return;
    }

    console.info(this.videoID, 'Video found, binding...');

    this.video.addEventListener('play', this.scheduleSkipHandler);
    this.video.addEventListener('pause', this.scheduleSkipHandler);
    this.video.addEventListener('seeked', this.scheduleSkipHandler);
    // `playing` covers a resume after buffering and `ratechange` the speed control,
    // both of which invalidate an armed wall-clock timeout.
    this.video.addEventListener('playing', this.scheduleSkipHandler);
    this.video.addEventListener('ratechange', this.scheduleSkipHandler);
    this.video.addEventListener('durationchange', this.durationChangeHandler);

    // Arm the first skip here rather than waiting for an event. `timeupdate` used to do
    // this by accident — it fires within a few hundred milliseconds of anything — but
    // the events above are all edges, and segments routinely arrive from the API while
    // the video is already playing, with no further edge coming until the user acts.
    this.scheduleSkip();
  }

  buildOverlay() {
    if (this.segmentsoverlay) {
      console.info('Overlay already built');
      return;
    }

    if (!this.video || !this.video.duration) {
      console.info('No video duration yet');
      return;
    }

    const videoDuration = this.video.duration;
    const slider = document.querySelector('div[idomkey="slider"]');
    if (!slider) return setTimeout(() => this.buildOverlay(), 100);

    this.segmentsoverlay = document.createElement('div');

    this.segmentsoverlay.classList.add('ytLrProgressBarSlider', 'ytLrProgressBarSliderRectangularProgressBar');
    this.segmentsoverlay.style.setProperty('z-index', '10', 'important');
    this.segmentsoverlay.style.setProperty('background-color', 'rgba(0, 0, 0, 0)', 'important');
    this.segmentsoverlay.style.setProperty('width', '72rem', 'important');
    this.segmentsoverlay.style.setProperty('left', '4rem', 'important');
    const sliderRect = slider.getBoundingClientRect();
    if (!slider.classList.contains('ytLrProgressBarSlider')) {
      for (let i = 0; i < slider.classList.length; i++) {
        this.segmentsoverlay.classList.add(slider.classList[i]);
      }
      this.segmentsoverlay.style.setProperty('height', `${sliderRect.height}px`, 'important');
      this.segmentsoverlay.style.setProperty('bottom', `${sliderRect.bottom - sliderRect.top}px`, 'important');      
    }
    this.segments.forEach((segment) => {
      const [start, end] = segment.segment;
      const barType = barTypes[segment.category] || {
        color: 'blue',
        opacity: 0.7
      };

      const leftPercent = videoDuration ? (100.0 * start) / videoDuration : 0;
      const widthPercent = videoDuration ? (100.0 * (end - start)) / videoDuration : 0;

      const elm = document.createElement('div');
      elm.style.setProperty('background-color', barType.color, 'important');
      elm.style.setProperty('opacity', barType.opacity, 'important');
      elm.style.setProperty('height', '100%', 'important');
      elm.style.setProperty('width', `${segment.category === 'poi_highlight' ? 1 : widthPercent}%`, 'important');
      elm.style.setProperty('left', `${leftPercent}%`, 'important');
      elm.style.setProperty('position', 'absolute', 'important');
      this.segmentsoverlay.appendChild(elm);
    });

    // One pass per batch, not one per record. The progress bar mutates continuously
    // while a video plays, so a batch of several hundred records used to mean several
    // hundred document-wide queries and as many style writes. The query is hoisted for
    // the same reason and null-guarded: it used to throw once per record whenever the
    // progress bar was between renders.
    this.observer = new MutationObserver((mutations) => {
      let detached = false;

      for (let i = 0; i < mutations.length; i++) {
        const removed = mutations[i].removedNodes;
        for (let j = 0; j < removed.length; j++) {
          if (removed[j] === this.segmentsoverlay) detached = true;
        }
      }

      if (detached && this.slider && this.segmentsoverlay) {
        this.slider.appendChild(this.segmentsoverlay);
      }

      this.refreshOverlay();
    });

    this.sliderInterval = setInterval(() => {
      this.slider = document.querySelector('ytlr-redux-connect-ytlr-progress-bar');
      if (this.slider) {
        clearInterval(this.sliderInterval);
        this.sliderInterval = null;
        this.observer.observe(this.slider, {
          childList: true,
          subtree: true
        });
        this.slider.appendChild(this.segmentsoverlay);
        this.refreshOverlay();
      }
    }, 500);
  }

  // Both things this does read layout, and the observer driving it fires many times a
  // second, so it is coalesced to at most one pass per frame and the read happens
  // inside the frame rather than in the middle of a mutation callback.
  refreshOverlay() {
    if (this.overlayFrame !== null || !this.segmentsoverlay) return;

    const schedule = window.requestAnimationFrame
      ? (fn) => window.requestAnimationFrame(fn)
      : (fn) => setTimeout(fn, 16);

    this.overlayFrame = schedule(() => {
      this.overlayFrame = null;
      if (!this.segmentsoverlay) return;

      const progressBar = document.querySelector('ytlr-progress-bar');
      const hidden = progressBar
        && progressBar.getAttribute('hybridnavfocusable') === 'false';

      this.segmentsoverlay.style.setProperty('display', hidden ? 'none' : 'block', 'important');

      // Only the older layout needs the overlay pinned to the slider's own offset, and
      // which layout this is cannot change within a video.
      if (this.isOldUI === undefined) {
        this.isOldUI = !document.querySelector('div[idomkey="Metadata-Section"]');
      }
      if (!this.isOldUI) return;

      const slider = document.querySelector('div[idomkey="slider"]');
      if (slider) {
        this.segmentsoverlay.style.setProperty('top', `${slider.getBoundingClientRect().top}px`, 'important');
      }
    });
  }

  scheduleSkip() {
    clearTimeout(this.nextSkipTimeout);
    this.nextSkipTimeout = null;

    if (!this.active) {
      console.info(this.videoID, 'No longer active, ignoring...');
      return;
    }

    if (this.video.paused) {
      console.info(this.videoID, 'Currently paused, ignoring...');
      return;
    }

    // A timeupdate can fire right before an already-scheduled skip, so look back a
    // little and, at worst, skip at a negative interval (immediately).
    const nextSegments = this.segments.filter(
      (seg) =>
        seg.segment[0] > this.video.currentTime - 0.3 &&
        seg.segment[1] > this.video.currentTime - 0.3
    );
    nextSegments.sort((s1, s2) => s1.segment[0] - s2.segment[0]);

    if (!nextSegments.length) {
      console.info(this.videoID, 'No more segments');
      return;
    }

    const [segment] = nextSegments;
    const [start, end] = segment.segment;
    console.info(
      this.videoID,
      'Scheduling skip of',
      segment,
      'in',
      start - this.video.currentTime
    );

    this.nextSkipTimeout = setTimeout(() => {
      if (this.video.paused) {
        console.info(this.videoID, 'Currently paused, ignoring...');
        return;
      }

      // A wall-clock timeout is only ever an estimate of when media time will reach
      // the segment: buffering, a decoder stall or a playback-rate change all pull the
      // two apart. `timeupdate` used to hide that by re-scheduling four times a second.
      // Rather than pay for that, check on arrival and re-arm if playback is not there
      // yet — which also makes the event list below an optimisation rather than a
      // correctness requirement.
      if (this.video.currentTime < start - 1) {
        console.info(this.videoID, 'Segment not reached yet, rescheduling');
        return this.scheduleSkip();
      }
      if (!this.skippableCategories.includes(segment.category)) {
        console.info(
          this.videoID,
          'Segment',
          segment.category,
          'is not skippable, ignoring...'
        );
        return;
      }

      const skipName = barTypes[segment.category]?.name || segment.category;
      console.info(this.videoID, 'Skipping', segment);
      if (!this.manualSkippableCategories.includes(segment.category)) {
        const wasSkippedBefore = this.skippedCategories.get(segment.UUID)
        if (wasSkippedBefore) {
          wasSkippedBefore.count++;
          wasSkippedBefore.lastSkipped = Date.now();
          this.skippedCategories.set(segment.UUID, wasSkippedBefore);

          if (wasSkippedBefore.lastSkipped - wasSkippedBefore.firstSkipped < 1000) {
            if (!wasSkippedBefore.hasShownToast) {
              if (configRead('enableSponsorBlockToasts')) {
                showToast('SponsorBlock', `Not skipping ${skipName} (was skipped ${wasSkippedBefore.count} times)`);
              }
              wasSkippedBefore.hasShownToast = true;
              this.skippedCategories.set(segment.UUID, wasSkippedBefore);
            }
            return;
          }
        } else {
          this.skippedCategories.set(segment.UUID, {
            count: 1,
            firstSkipped: Date.now(),
            lastSkipped: Date.now(),
            hasShownToast: false
          });
        }
        if (configRead('enableSponsorBlockToasts')) {
          showToast('SponsorBlock', `Skipping ${skipName}`);
        }
        if (this.video.duration - end < 1) {
          this.video.currentTime = end - 1;
        } else this.video.currentTime = end;
        this.scheduleSkip();
      }
    }, (start - this.video.currentTime) * 1000);
  }

  destroy() {
    console.info(this.videoID, 'Destroying');

    this.active = false;

    if (this.nextSkipTimeout) {
      clearTimeout(this.nextSkipTimeout);
      this.nextSkipTimeout = null;
    }

    if (this.attachVideoTimeout) {
      clearTimeout(this.attachVideoTimeout);
      this.attachVideoTimeout = null;
    }

    if (this.sliderInterval) {
      clearInterval(this.sliderInterval);
      this.sliderInterval = null;
    }

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.overlayFrame !== null) {
      if (window.cancelAnimationFrame) window.cancelAnimationFrame(this.overlayFrame);
      else clearTimeout(this.overlayFrame);
      this.overlayFrame = null;
    }

    if (this.segmentsoverlay) {
      this.segmentsoverlay.remove();
      this.segmentsoverlay = null;
    }

    if (this.video) {
      this.video.removeEventListener('play', this.scheduleSkipHandler);
      this.video.removeEventListener('pause', this.scheduleSkipHandler);
      this.video.removeEventListener('seeked', this.scheduleSkipHandler);
      this.video.removeEventListener('playing', this.scheduleSkipHandler);
      this.video.removeEventListener('ratechange', this.scheduleSkipHandler);
      this.video.removeEventListener(
        'durationchange',
        this.durationChangeHandler
      );
    }

    this.skippedCategories.clear();
  }
}

// Declared with var, not let: two consecutive hashchange events would leave the second
// call seeing the pre-update value and initialising SponsorBlockHandler twice. Noticed
// on Chromium 38.
window.sponsorblock = null;

window.addEventListener(
  'hashchange',
  () => {
    const newURL = new URL(location.hash.substring(1), location.href);
    const videoID = newURL.search.replace('?v=', '').split('&')[0];
    const needsReload =
      videoID &&
      (!window.sponsorblock || window.sponsorblock.videoID != videoID);

    console.info(
      'hashchange',
      videoID,
      window.sponsorblock,
      window.sponsorblock ? window.sponsorblock.videoID : null,
      needsReload
    );

    if (needsReload) {
      if (window.sponsorblock) {
        try {
          window.sponsorblock.destroy();
        } catch (err) {
          console.warn('window.sponsorblock.destroy() failed!', err);
        }
        window.sponsorblock = null;
      }

      if (configRead('enableSponsorBlock')) {
        window.sponsorblock = new SponsorBlockHandler(videoID);
        window.sponsorblock.init();
      } else {
        console.info('SponsorBlock disabled, not loading');
      }
    }
  },
  false
);
