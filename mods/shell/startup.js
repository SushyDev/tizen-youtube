import css from './ui.css';
import { claimCommands, configRead, onKey, reloadGuide, resolve, whenFound, whenVideo } from '../../framework/index.js';
import { claimInterpreters } from '../commands/interpreters.js';
import { pipToFullscreen } from '../player/pictureInPicture.js';
const RIGHT = 39;

const once = { started: false };

const start = () => {
  claimInterpreters();
  takeOverKeys();

  // This file used to wait for a video before doing anything at all. whenVideo says so again, but
  // it also fires when the page swaps the element mid-session — and none of this wants doing twice.
  whenVideo('ui shell', () => {
    if (once.started) return;
    once.started = true;

    addStyles();

    // Counted to forty and then gave up quietly. whenFound already knows how to stop, and says so.
    whenFound('command resolver', () => claimCommands() || null, () => undefined, { everyMs: 250 });

    goToStartPage();
    reloadGuide();
  });
};

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

function takeOverKeys() {
  // Never swallowed the key, so it still does not: returning nothing lets it through.
  onKey('pip fullscreen', [RIGHT], (event) => {
    if (event.type !== 'keydown') return undefined;

    if (window.isPipPlaying
        && document.querySelector('ytlr-search-text-box > .zylon-focus')) {
      const player = document.querySelector('ytlr-player');
      if (player) player.style.setProperty('background-color', 'rgb(0, 0, 0)');
      pipToFullscreen();
    }

    return undefined;
  });
}

const WELCOME_POLL = 250;

function onWelcomeScreen() {
  const welcome = document.querySelector('ytlr-welcome');
  return !!welcome && welcome.getBoundingClientRect().height > 0;
}

// Polled for the welcome screen to go away and never stopped: a viewer who left it up kept a timer
// running four times a second for as long as the app was open. whenFound gives up.
function goToStartPage() {
  if (!configRead('reloadHomeOnStartup')) return;

  whenFound('start page', () => !onWelcomeScreen(), () => {
    const launchTo = configRead('launchToOnStartup');

    resolve(launchTo
      ? JSON.parse(launchTo)
      : { signalAction: { signal: 'SOFT_RELOAD_PAGE' } });
  }, { everyMs: WELCOME_POLL });
}

export { start };
