import css from './ui.css';
import { claimCommands, configRead, onKey, reloadGuide, resolve, whenFound, whenVideo } from '../../framework/index.js';
import { claimInterpreters } from '../commands/interpreters.js';
import { pipToFullscreen } from '../player/pictureInPicture.js';

const RIGHT = 39;

const once = { started: false };

const start = () => {
  claimInterpreters();
  takeOverKeys();

  // Runs once, although whenVideo fires again when the page swaps the element.
  whenVideo('ui shell', () => {
    if (once.started) return;
    once.started = true;

    addStyles();

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
