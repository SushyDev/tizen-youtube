import css from './ui.css';
import { configRead } from '../config.js';
import { interceptCommands } from '../youtube/commands.js';
import { resolve } from '../youtube/internals.js';
import { pipToFullscreen } from '../features/pictureInPicture.js';
import { reloadGuide } from '../youtube/internals.js';

// Wiring the modification into YouTube once YouTube exists. There is no meaningful
// load event — the script is evaluated into a page that builds itself afterwards — so
// a <video> element is the cheapest reliable signal that the player is constructed.

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
    console.warn('Could not find YouTube\'s command resolver; settings will not work.');
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
    // `class` only. Watching every attribute on body woke this on changes it can do
    // nothing about, and the removal below is itself a class mutation, so the callback
    // re-enters once per removal either way.
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  } catch (e) { /* no MutationObserver on this build */ }
}

function takeOverKeys() {
  const onKey = (event) => {
    if (event.type !== 'keydown') return;

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

// YouTube's own first-run flow — the value proposition, then the sign-in screen with
// its QR code and pairing code — is drawn inside <ytlr-welcome> and stays there until
// the set has an account or the viewer has chosen to go without one. A <video> element
// exists while it is on screen, so the signal `start()` waits on says nothing about
// whether YouTube is finished with the screen.
const WELCOME_POLL = 250;

// Present but unrendered is YouTube holding on to the element, not showing it.
function onWelcomeScreen() {
  const welcome = document.querySelector('ytlr-welcome');
  return !!welcome && welcome.getBoundingClientRect().height > 0;
}

// YouTube restores whatever was last on screen, which after a video is that video's
// page. Landing on the home feed is what every other TV app does.
function goToStartPage() {
  if (!configRead('reloadHomeOnStartup')) return;

  // Waiting rather than skipping: navigating over the first-run flow dropped people on
  // a guest home feed a second after the app opened, halfway through signing in, and
  // skipping outright would cost them the start page they asked for once they are
  // through it. There is nothing to restore in the meantime, and the wait ends the
  // moment YouTube gives the screen back.
  if (onWelcomeScreen()) {
    setTimeout(goToStartPage, WELCOME_POLL);
    return;
  }

  const launchTo = configRead('launchToOnStartup');

  resolve(launchTo
    ? JSON.parse(launchTo)
    : { signalAction: { signal: 'SOFT_RELOAD_PAGE' } });
}
