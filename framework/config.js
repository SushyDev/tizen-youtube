import { DEV_TOOLS } from './flags.js';

const CONFIG_KEY = 'tube.settings';

const HIDDEN_SIDEBAR_ITEMS = [
  'YOUTUBE_SHORTS_FILL_24',
  'TROPHY',
  'NEWS',
  'YOUTUBE_MUSIC',
  'BROADCAST',
  'CLAPPERBOARD',
  'LIVE',
  'GAMING'
];

const defaultConfig = {
  enableAdBlock: true,

  enableSponsorBlock: true,
  enableSponsorBlockToasts: false,
  enableSponsorBlockSponsor: true,
  enableSponsorBlockIntro: true,
  enableSponsorBlockOutro: true,
  enableSponsorBlockInteraction: true,
  enableSponsorBlockSelfPromo: true,
  enableSponsorBlockPreview: true,
  enableSponsorBlockMusicOfftopic: true,
  enableSponsorBlockFiller: false,
  enableSponsorBlockHighlight: true,
  sponsorBlockManualSkips: ['intro', 'outro', 'filler'],

  enableDeArrow: false,
  enableDeArrowThumbnails: false,

  preferredVideoQuality: 'highest',
  videoPreferredCodec: 'any',
  enableDevBridge: DEV_TOOLS,
  videoSpeed: 1,
  rememberPlaybackSpeed: false,
  speedSettingsIncrement: 0.25,

  enableShorts: false,
  disabledSidebarContents: HIDDEN_SIDEBAR_ITEMS,

  enableHqThumbnails: true,

  hideShoppingAction: true,
  enableHideEndScreenCards: false,
  enablePaidPromotionOverlay: true,
  enableUpNextCard: true,
  enableYouThereRenderer: true,
  enableSigninReminder: false,
  enableWhoIsWatchingMenu: false,
  permanentlyEnableWhoIsWatchingMenu: false,
  enableWhosWatchingMenuOnAppExit: false,

  enableHideWatchedVideos: false,
  hideWatchedVideosThreshold: 80,
  hideWatchedVideosPages: [],

  enablePreviousNextButtons: true,
  enableMPButton: true,
  enableSuperThanksButton: false,
  enableAIAskButton: false,

  enableShowUserLanguage: true,
  enableShowOtherLanguages: false,

  // The browseId the app opens on, empty for wherever YouTube would have gone — which is home.
  startupPage: '',

  // A rung such as '2', empty for YouTube's own pacing.
  scrollSpeed: '',
  enableRapidPress: true,
  enableSmoothNavigation: true,
};

function readStoredSettings() {
  try {
    const parsed = JSON.parse(window.localStorage[CONFIG_KEY]);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.warn('Stored settings were unreadable; starting from defaults.', e);
    return {};
  }
}

const RETIRED_STARTUP_KEYS = ['launchToOnStartup', 'reloadHomeOnStartup'];

function startPageOf(launchTo) {
  try {
    const browseId = JSON.parse(launchTo).browseEndpoint.browseId;
    return typeof browseId === 'string' && browseId !== 'FEtopics' ? browseId : '';
  } catch (e) {
    return '';
  }
}

function migrateStartPage(settings) {
  const current = Object.keys(settings)
    .filter((key) => RETIRED_STARTUP_KEYS.indexOf(key) === -1)
    .reduce((kept, key) => Object.assign({}, kept, { [key]: settings[key] }), {});

  return settings.reloadHomeOnStartup === true && settings.startupPage === undefined
    ? Object.assign({}, current, { startupPage: startPageOf(settings.launchToOnStartup) })
    : current;
}

const stored = migrateStartPage(readStoredSettings());

const localConfig = Object.assign({}, defaultConfig, stored);

export function configRead(key) {
  return localConfig[key] !== undefined ? localConfig[key] : defaultConfig[key];
}

export function configWrite(key, value) {
  localConfig[key] = value;

  const changed = {};
  Object.keys(defaultConfig).forEach((name) => {
    if (localConfig[name] !== defaultConfig[name]) changed[name] = localConfig[name];
  });

  try {
    window.localStorage[CONFIG_KEY] = JSON.stringify(changed);
  } catch (e) {
    console.warn('Could not persist settings.', e);
  }

  configChangeEmitter.dispatchEvent(new CustomEvent('configChange', { detail: { key, value } }));
}

export const configChangeEmitter = {
  listeners: {},
  addEventListener(type, callback) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(callback);
  },
  removeEventListener(type, callback) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(cb => cb !== callback);
  },
  dispatchEvent(event) {
    const type = event.type;
    if (!this.listeners[type]) return;
    this.listeners[type].forEach(cb => {
      try {
        cb.call(this, event);
      } catch (_) { }
    });
  }
};
