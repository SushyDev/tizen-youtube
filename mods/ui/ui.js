import css from './ui.css';
import { configRead } from '../config.js';
import { openAdditionalOptions } from './settings.js';
import { interceptCommands } from '../youtube/commands.js';
import { resolve } from '../youtube/internals.js';
import { pipToFullscreen } from '../features/pictureInPicture.js';
import { reloadGuide } from '../youtube/internals.js';

// Wiring the modification into YouTube once YouTube exists. There is no meaningful
// load event — the script is evaluated into a page that builds itself afterwards — so
// a <video> element is the cheapest reliable signal that the player is constructed.

const GREEN_BUTTON = 404;
const RIGHT = 39;

const ready = setInterval(() => {
  if (!document.querySelector('video')) return;
  clearInterval(ready);
  start();
}, 250);

function start() {
  addStyles();
  liftLowEndRestrictions();
  claimCommands();
  takeOverKeys();
  goToStartPage();

  // The guide is built before this script runs, so the trimmed sidebar only appears
  // once YouTube is asked to build it again.
  reloadGuide();
}

// The resolver singleton is registered by YouTube's bundle, so it can arrive after the
// player element this file waits on. Keep asking, but stop eventually: an endless
// interval is a frame cost for the life of the session.
function claimCommands(attempt = 0) {
  if (interceptCommands()) return;

  if (attempt > 40) {
    console.warn('Could not find YouTube\'s command resolver; settings will not open.');
    return;
  }

  setTimeout(() => claimCommands(attempt + 1), 250);
}

// YouTube's own stylesheet carries a nonce, so appending to it keeps everything under
// one CSP-approved element.
function addStyles() {
  const existing = document.querySelector('style[nonce]');
  if (existing) {
    existing.textContent += css;
    return;
  }

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

// YouTube profiles a television as a low-end device and disables animations, long-press
// and scroll behaviour. That difference is most of what makes this feel slower than the
// app Samsung ships.
function liftLowEndRestrictions() {
  if (!configRead('enableFixedUI')) return;

  try {
    window.tectonicConfig.featureSwitches.isLimitedMemory = false;
    window.tectonicConfig.clientData.legacyApplicationQuality = 'full-animation';
    window.tectonicConfig.featureSwitches.enableAnimations = true;
    window.tectonicConfig.featureSwitches.enableOnScrollLinearAnimation = true;
    window.tectonicConfig.featureSwitches.enableListAnimations = true;
    window.tectonicConfig.featureSwitches.supportsLongPress = true;
  } catch (e) { /* a YouTube build without these switches */ }

  // YouTube puts the class back whenever it re-renders, so it has to be removed on
  // every attribute change rather than once at startup.
  try {
    const observer = new MutationObserver(() => {
      if (document.body.classList.contains('app-quality-root')) {
        document.body.classList.remove('app-quality-root');
      }
    });
    observer.observe(document.body, { attributes: true });
  } catch (e) { /* no MutationObserver on this build */ }
}

function takeOverKeys() {
  const onKey = (event) => {
    if (event.type !== 'keydown') return;

    if (event.keyCode === GREEN_BUTTON) {
      openAdditionalOptions();
      return;
    }

    // Right on the search box while a mini player is running promotes it back to
    // fullscreen, which is otherwise a dead end.
    if (event.keyCode === RIGHT
        && window.isPipPlaying
        && document.querySelector('ytlr-search-text-box > .zylon-focus')) {
      const player = document.querySelector('ytlr-player');
      if (player) player.style.setProperty('background-color', 'rgb(0, 0, 0)');
      pipToFullscreen();
    }
  };

  ['keydown', 'keypress', 'keyup'].forEach((type) =>
    document.addEventListener(type, onKey, true));
}

// YouTube restores whatever was last on screen, which after a video is that video's
// page. Landing on the home feed is what every other TV app does.
function goToStartPage() {
  if (!configRead('reloadHomeOnStartup')) return;

  const launchTo = configRead('launchToOnStartup');

  resolve(launchTo
    ? JSON.parse(launchTo)
    : { signalAction: { signal: 'SOFT_RELOAD_PAGE' } });
}
