// What the app does before anyone touches a setting.
//
// Defaults are the product. Almost nobody opens a settings menu on a
// television — the remote makes it tedious enough that whatever ships is what
// people live with. So this file is opinionated: the things that make YouTube
// on a TV worse are off, the things that make it better are on, and the
// menu is there to disagree with rather than to configure from scratch.

// Deliberately not the key the reference used.
//
// Two reasons, and either alone would be enough. Stored settings win over
// defaults — that is the point of storing them — so a TV that has run this
// app before would keep every old default and never see a single change made
// here. And this runs on youtube.com, where localStorage is shared with any
// other modification installed on the same television; the reference's key is
// one another app may well be writing.
const CONFIG_KEY = 'tube.settings';

// The sidebar, trimmed to what a person actually navigates to.
//
// YouTube's guide lists eight content categories alongside the places anyone
// actually goes. Each is a row to skip past with a d-pad. These are the icon
// types the guide renderer tags its entries with; anything named here is
// dropped before the guide is drawn.
//
// What is left: search, home, subscriptions, library and more.
const HIDDEN_SIDEBAR_ITEMS = [
  'YOUTUBE_SHORTS_FILL_24',  // shorts
  'TROPHY',                  // sports
  'NEWS',
  'YOUTUBE_MUSIC',
  'BROADCAST',               // podcasts
  'CLAPPERBOARD',            // movies & tv
  'LIVE',
  'GAMING'
];

const defaultConfig = {
  // ── Blocking ────────────────────────────────────────────────────────
  enableAdBlock: true,

  // SponsorBlock skips the parts of a video the uploader was paid for. Every
  // category worth skipping is on; the toast that announces each skip is not,
  // because a notification sliding in over the picture every few minutes is
  // the opposite of the app disappearing into the television.
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

  // DeArrow replaces titles and thumbnails with crowd-sourced ones. It is a
  // good idea that reads as a broken YouTube: half the shelf is in someone
  // else's voice, and thumbnails arrive late over a slow TV connection.
  enableDeArrow: false,
  enableDeArrowThumbnails: false,

  // ── Playback ────────────────────────────────────────────────────────
  // A television is the one screen where the best picture is almost always
  // the right answer — it is wired, it is stationary, and nobody is paying
  // for the bytes by the megabyte. 2160p rather than "highest" because it is
  // the ceiling of the panel; anything above it is bandwidth spent on pixels
  // that get thrown away. A video without it falls to the nearest below.
  preferredVideoQuality: '2160p',
  videoPreferredCodec: 'any',
  videoSpeed: 1,
  speedSettingsIncrement: 0.25,

  // ── What is on screen ───────────────────────────────────────────────
  enableShorts: false,
  disabledSidebarContents: HIDDEN_SIDEBAR_ITEMS,
  disableChannelsOnSidebar: false,

  // YouTube treats a TV as a low-end device and turns off animations and
  // long-press for it. These are not low-end devices.
  enableFixedUI: true,
  enableLongPress: true,
  enablePreviews: true,
  enableHqThumbnails: true,

  // Overlays and interruptions, all off. Each one is a thing that appears
  // over a video you were watching.
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

  // ── Player controls ─────────────────────────────────────────────────
  enablePatchingVideoPlayer: true,
  enablePreviousNextButtons: true,
  enableSpeedControlsButton: true,
  enableMPButton: true,
  enableSwapMPWithPIP: false,
  // Two buttons YouTube puts under every video that nobody on a TV has ever
  // wanted: paying the uploader, and asking a chatbot about the video.
  enableSuperThanksButton: false,
  enableAIAskButton: false,

  // ── Subtitles ───────────────────────────────────────────────────────
  enableShowUserLanguage: true,
  enableShowOtherLanguages: false,

  // ── Startup ─────────────────────────────────────────────────────────
  launchToOnStartup: null,
  reloadHomeOnStartup: true,

  // ── Theme ───────────────────────────────────────────────────────────
  focusContainerColor: '#0f0f0f',
  routeColor: '#0f0f0f'
};

// Reading what was stored last time, defensively.
//
// This runs before anything else in the userscript, so a throw here takes the
// whole modification with it and YouTube comes up unmodified — ads and all —
// with nothing on screen to say why. Storage can hold a truncated write, the
// string "undefined", or `null`, and each of those breaks a different naive
// parse. None of them is worth losing the app over, so any of them simply
// means "no stored settings yet".
const stored = (() => {
  try {
    const parsed = JSON.parse(window.localStorage[CONFIG_KEY]);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.warn('Stored settings were unreadable; starting from defaults.', e);
    return {};
  }
})();

// A copy, never the defaults object itself: writing through to the defaults
// would make "restore to default" impossible and leak between reads.
const localConfig = Object.assign({}, defaultConfig, stored);

export function configRead(key) {
  return localConfig[key] !== undefined ? localConfig[key] : defaultConfig[key];
}

export function configWrite(key, value) {
  localConfig[key] = value;

  try {
    window.localStorage[CONFIG_KEY] = JSON.stringify(localConfig);
  } catch (e) {
    // Full or disabled storage must not stop the setting taking effect for
    // this session.
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
      } catch (_) { /* one bad listener must not stop the others */ }
    });
  }
};
