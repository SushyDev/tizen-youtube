// Deliberately not the key the reference used: stored settings win over defaults, and
// localStorage on youtube.com is shared with every other modification on the TV.
const CONFIG_KEY = 'tube.settings';

// The icon types the guide renderer tags its entries with; anything named here is
// dropped. What is left: search, home, subscriptions, library and more.
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
  // Blocking
  enableAdBlock: true,

  enableSponsorBlock: true,
  // Off: a message over the picture every few minutes defeats the point of skipping
  // quietly in the first place.
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

  // DeArrow's crowd-sourced titles read as a broken YouTube, and its thumbnails arrive
  // late over a slow TV connection.
  enableDeArrow: false,
  enableDeArrowThumbnails: false,

  // Playback
  // "Highest" is an instruction rather than a resolution: the top of whatever the video
  // actually offers, which naming one cannot promise.
  preferredVideoQuality: 'highest',
  videoPreferredCodec: 'any',
  // The platform player counts nothing, so the stats line shows a dash. Derived from
  // playback continuity and marked as such, but a dash is no more honest.
  reportPlaybackStats: true,
  // Plays the picture from a local stream rather than through MediaSource. Same decoder,
  // same element, same media: through MediaSource this hardware drops frames at 2160p60,
  // and from a plain URL it drops none.
  //
  // Off by default while the player's own interface is still upset by it — a television
  // that plays everything and judders beats one that does not play.
  bypassMediaSource: false,
  // How that stream is described to the set. Both are handed over as a plain URL and both
  // are played by the set's own pipeline; only the description differs. DASH is what this
  // was built on; HLS is the better-trodden path on a Samsung, being what broadcast apps
  // ship, and is here to be measured against it rather than assumed better. A plain file
  // is neither: no manifest, no playlist, nothing for the set to decide — and so no
  // seeking either, which is why it is a measurement rather than a default.
  nativePlaybackContainer: 'dash',
  // Publishes readings on the network and runs evaluate requests, while debugging.
  enableDevBridge: true,
  videoSpeed: 1,
  // Carrying a speed from one video to the next is this app's doing, not YouTube's, which
  // starts every video at normal speed. Off to match it.
  rememberPlaybackSpeed: false,
  speedSettingsIncrement: 0.25,

  // What is on screen
  enableShorts: false,
  disabledSidebarContents: HIDDEN_SIDEBAR_ITEMS,
  disableChannelsOnSidebar: false,

  // Off by default: on an LCD, #0f0f0f and #000000 look the same and the second is
  // only a loss of contrast.
  enableOledTheme: false,

  // YouTube treats a TV as a low-end device and disables animations and long-press.
  enableFixedUI: true,
  enableLongPress: true,
  enablePreviews: true,
  enableHqThumbnails: true,

  // Overlays and interruptions that appear over a video you were watching.
  // The shopping panel is merchandise sold over the picture, which is the one thing
  // an app that drops adverts should not be leaving in.
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

  // Player controls
  enablePatchingVideoPlayer: true,
  enablePreviousNextButtons: true,
  enableSpeedControlsButton: true,
  enableMPButton: true,
  enableSwapMPWithPIP: false,
  // Paying the uploader and asking a chatbot about the video.
  enableSuperThanksButton: false,
  enableAIAskButton: false,

  // Subtitles
  enableShowUserLanguage: true,
  enableShowOtherLanguages: false,

  // Startup. The page is stored as the command that opens it, which is what the
  // settings row offers; the literal has to match what settingsModel.js builds.
  launchToOnStartup: '{"browseEndpoint":{"browseId":"FEtopics"}}',
  reloadHomeOnStartup: true,

  // Theme
  focusContainerColor: '#0f0f0f',
  routeColor: '#0f0f0f'
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

  // Only what differs from the defaults is stored. Writing the whole object would
  // freeze every default at whatever it was the first time anything was changed, and a
  // later change to one would never reach anybody who already has the app.
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
      } catch (_) { /* one bad listener must not stop the others */ }
    });
  }
};
