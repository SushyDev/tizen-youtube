import { DEV_TOOLS } from './dev/tools.js';

// Not the key the reference used: localStorage on youtube.com is shared with every
// other modification on the TV.
const CONFIG_KEY = 'tube.settings';

const HIDDEN_SIDEBAR_ITEMS = [
  'YOUTUBE_SHORTS_FILL_24',
  'TROPHY',                  // sports
  'NEWS',
  'YOUTUBE_MUSIC',
  'BROADCAST',               // podcasts
  'CLAPPERBOARD',            // movies & tv
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
  reportPlaybackStats: true,
  bypassMediaSource: false,
  nativePlaybackContainer: 'dash',
  enableDevBridge: DEV_TOOLS,
  videoSpeed: 1,
  rememberPlaybackSpeed: false,
  speedSettingsIncrement: 0.25,

  enableShorts: false,
  disabledSidebarContents: HIDDEN_SIDEBAR_ITEMS,
  disableChannelsOnSidebar: false,

  enableOledTheme: false,

  enableFixedUI: true,
  enableLongPress: true,
  enablePreviews: true,
  enableHqThumbnails: true,

  hideShoppingAction: true,
  enableHideEndScreenCards: false,
  enablePaidPromotionOverlay: true,
  enableYouThereRenderer: true,
  enableSigninReminder: false,
  enableWhoIsWatchingMenu: false,
  permanentlyEnableWhoIsWatchingMenu: false,
  enableWhosWatchingMenuOnAppExit: false,

  enableHideWatchedVideos: false,
  hideWatchedVideosThreshold: 80,
  hideWatchedVideosPages: [],
  sortSubscriptionsByAlphabet: true,

  enablePatchingVideoPlayer: true,
  enablePreviousNextButtons: true,
  enableSpeedControlsButton: true,
  enableMPButton: true,
  enableSwapMPWithPIP: false,
  enableSuperThanksButton: false,
  enableAIAskButton: false,

  enableShowUserLanguage: true,
  enableShowOtherLanguages: false,

  launchToOnStartup: '{"browseEndpoint":{"browseId":"FEtopics"}}',
  reloadHomeOnStartup: true
};

// Runs before anything else in the userscript, so a throw here takes the whole
// modification with it. A truncated write, "undefined" and null all mean "nothing stored".
const stored = (() => {
  try {
    const parsed = JSON.parse(window.localStorage[CONFIG_KEY]);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.warn('Stored settings were unreadable; starting from defaults.', e);
    return {};
  }
})();

// A copy, never the defaults object itself, or "restore to default" becomes impossible.
const localConfig = Object.assign({}, defaultConfig, stored);

export function configRead(key) {
  return localConfig[key] !== undefined ? localConfig[key] : defaultConfig[key];
}

export function configWrite(key, value) {
  localConfig[key] = value;

  // Only the difference from the defaults, or a later change to a default would never
  // reach anybody who already has the app.
  const changed = {};
  Object.keys(localConfig).forEach((name) => {
    if (localConfig[name] !== defaultConfig[name]) changed[name] = localConfig[name];
  });

  try {
    window.localStorage[CONFIG_KEY] = JSON.stringify(changed);
  } catch (e) {
    // Full or disabled storage must not stop the setting taking effect this session.
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
