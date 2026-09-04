import css from './ui.css';
import { configRead } from '../config.js';
import { interceptCommands } from '../youtube/commands.js';
import { resolve } from '../youtube/internals.js';
import { pipToFullscreen } from '../features/pictureInPicture.js';
import { reloadGuide } from '../youtube/internals.js';

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

  reloadGuide();
}

function claimCommands(attempt = 0) {
  if (interceptCommands()) return;

  if (attempt > 40) {
    console.warn('Could not find YouTube\'s command resolver; settings will not work.');
    return;
  }

  setTimeout(() => claimCommands(attempt + 1), 250);
}

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

function liftLowEndRestrictions() {
  if (!configRead('enableFixedUI')) return;

  try {
    window.tectonicConfig.featureSwitches.isLimitedMemory = false;
    window.tectonicConfig.clientData.legacyApplicationQuality = 'full-animation';
    window.tectonicConfig.featureSwitches.enableAnimations = true;
    window.tectonicConfig.featureSwitches.enableOnScrollLinearAnimation = true;
    window.tectonicConfig.featureSwitches.enableListAnimations = true;
    window.tectonicConfig.featureSwitches.supportsLongPress = true;
  } catch (e) { }

  try {
    const observer = new MutationObserver(() => {
      if (document.body.classList.contains('app-quality-root')) {
        document.body.classList.remove('app-quality-root');
      }
    });
    observer.observe(document.body, { attributes: true });
  } catch (e) { }
}

function takeOverKeys() {
  const onKey = (event) => {
    if (event.type !== 'keydown') return;

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

const WELCOME_POLL = 250;

function onWelcomeScreen() {
  const welcome = document.querySelector('ytlr-welcome');
  return !!welcome && welcome.getBoundingClientRect().height > 0;
}

function goToStartPage() {
  if (!configRead('reloadHomeOnStartup')) return;

  if (onWelcomeScreen()) {
    setTimeout(goToStartPage, WELCOME_POLL);
    return;
  }

  const launchTo = configRead('launchToOnStartup');

  resolve(launchTo
    ? JSON.parse(launchTo)
    : { signalAction: { signal: 'SOFT_RELOAD_PAGE' } });
}
