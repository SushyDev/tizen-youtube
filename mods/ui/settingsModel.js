import { configRead } from '../config.js';

// Every setting this app owns, once, in the order it is shown. Two things read this
// file: nativeSettings.js, which turns it into rows on YouTube's own settings page, and
// settingsOptions.js, which draws the list a row opens when its answer is one of
// several. Nothing else knows a config key by name, so adding a setting is one entry
// here, and it appears on the settings page grouped under the heading it is written
// under.

// YouTube's own settings illustrations. There is no other set on the device, and a row
// without one draws a hole where the picture goes, so every item names one.
const ART = 'https://www.gstatic.com/ytlr/img/';

const BLOCKING = ART + 'restricted_mode.png';     // a crossed-out circle
const MONEY = ART + 'purchases_and_memberships.png';
const SKIPPING = ART + 'autoplay.png';            // an arrow, running on
const WATCHED = ART + 'clear_watch_history.png';  // spectacles
const LOOKING = ART + 'clear_search_history.png'; // a lens over a picture
const SCREEN = ART + 'living_room_pre_app_user_setting.png';
const CONTROLS = ART + 'linked_devices.png';
const SPEECH = ART + 'language.png';
const PRIVACY = ART + 'privacy_and_terms.png';
const RESTART = ART + 'reset_app.png';
const MESSAGE = ART + 'send_feedback.png';

// The one picture YouTube does not have. Drawn in the same hand as the rest of them:
// flat shapes, one accent, a stray pen stroke.
const CONTRAST = 'data:image/svg+xml;charset=utf-8,'
  + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">'
    + '<circle cx="48" cy="48" r="31" fill="#0b0b0b" stroke="#25c4b0" stroke-width="7"/>'
    + '<path d="M48 17a31 31 0 0 1 0 62z" fill="#25c4b0"/>'
    + '<path d="M17 79c7-6 13-9 19-9" stroke="#f0555f" stroke-width="4.5" fill="none" stroke-linecap="round"/>'
    + '<path d="M74 20l7-7M81 27l7-7" stroke="#ffd25e" stroke-width="4.5" stroke-linecap="round"/>'
    + '</svg>');

// A switch is a boolean. `on` is the stored value that means "On", so a setting whose
// key is phrased as a negative — enableHideEndScreenCards — is still shown the way a
// person thinks about it.
const Switch = (key, title, summary, image, on = true) =>
  ({ kind: 'switch', key, title, summary, image, on });

// One of several. Shows the chosen one on the row itself.
const Choice = (key, title, summary, image, options, prefix) =>
  ({ kind: 'choice', key, title, summary, image, options, prefix: prefix || title });

// Several at once, stored as an array of the chosen values. `invert` is for the one
// setting that stores what to leave out rather than what to keep.
const Set_ = (key, title, summary, image, options, invert = false) =>
  ({ kind: 'set', key, title, summary, image, options, invert });

// Several at once, each with its own boolean key. Reads as one row, stores as many.
const Flags = (id, title, summary, image, options) =>
  ({ kind: 'flags', id, title, summary, image, options });

const QUALITIES = ['highest', 'auto', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p']
  .map((quality) => ({
    label: quality === 'highest' ? 'Highest available'
      : quality === 'auto' ? 'Automatic'
        : quality,
    value: quality
  }));

const CONTAINERS = [
  { label: 'DASH', value: 'dash' },
  { label: 'HLS', value: 'hls' },
  { label: 'Plain file', value: 'mp4' }
];

const CODECS = [
  { label: 'Any', value: 'any' },
  { label: 'VP9', value: 'vp9' },
  { label: 'AV1', value: 'av01' },
  { label: 'H.264', value: 'avc1' }
];

const INCREMENTS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5]
  .map((step) => ({ label: `${step}×`, value: step }));

const PERCENTAGES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
  .map((percent) => ({ label: `${percent}%`, value: percent }));

const SEGMENTS = [
  { label: 'Sponsors', key: 'enableSponsorBlockSponsor' },
  { label: 'Intros', key: 'enableSponsorBlockIntro' },
  { label: 'Outros', key: 'enableSponsorBlockOutro' },
  { label: 'Subscribe reminders', key: 'enableSponsorBlockInteraction' },
  { label: 'Self-promotion', key: 'enableSponsorBlockSelfPromo' },
  { label: 'Recaps and previews', key: 'enableSponsorBlockPreview' },
  { label: 'Tangents and jokes', key: 'enableSponsorBlockFiller' },
  { label: 'Non-music parts', key: 'enableSponsorBlockMusicOfftopic' },
  { label: 'Jump to the highlight', key: 'enableSponsorBlockHighlight' }
];

// The categories YouTube's own guide is built from, by the icon each entry carries.
const SIDEBAR = [
  { label: 'Search', value: 'SEARCH' },
  { label: 'Home', value: 'WHAT_TO_WATCH' },
  { label: 'Shorts', value: 'YOUTUBE_SHORTS_FILL_24' },
  { label: 'Subscriptions', value: 'SUBSCRIPTIONS' },
  { label: 'Library', value: 'TAB_LIBRARY' },
  { label: 'Sports', value: 'TROPHY' },
  { label: 'News', value: 'NEWS' },
  { label: 'Music', value: 'YOUTUBE_MUSIC' },
  { label: 'Podcasts', value: 'BROADCAST' },
  { label: 'Movies & TV', value: 'CLAPPERBOARD' },
  { label: 'Live', value: 'LIVE' },
  { label: 'Gaming', value: 'GAMING' },
  { label: 'More', value: 'TAB_MORE' }
];

const PAGES = [
  { label: 'Home', value: 'home' },
  { label: 'Search results', value: 'search' },
  { label: 'Subscriptions', value: 'subscriptions' },
  { label: 'Library', value: 'library' },
  { label: 'Music', value: 'music' },
  { label: 'Gaming', value: 'gaming' },
  { label: 'More', value: 'more' }
];

const page = (browseId) => JSON.stringify({ browseEndpoint: { browseId } });

const START_PAGES = [
  { label: 'Home', value: page('FEtopics') },
  { label: 'Search', value: JSON.stringify({ searchEndpoint: { query: '' } }) },
  { label: 'Subscriptions', value: page('FEsubscriptions') },
  { label: 'Library', value: page('FElibrary') },
  { label: 'Sports', value: page('FEtopics_sports') },
  { label: 'News', value: page('FEtopics_news') },
  { label: 'Music', value: page('FEtopics_music') },
  { label: 'Podcasts', value: page('FEtopics_podcasts') },
  { label: 'Movies & TV', value: page('FEtopics_movies') },
  { label: 'Live', value: page('FEtopics_live') },
  { label: 'Gaming', value: page('FEtopics_gaming') },
  { label: 'More', value: page('FEtopics_more') }
];

const GROUPS = [
  {
    id: 'tube_adblock',
    title: 'Ad blocking',
    items: [
      Switch('enableAdBlock', 'Enable',
        'Adverts are dropped from every response before the player is told they exist',
        BLOCKING)
    ]
  },
  {
    id: 'tube_sponsorblock',
    title: 'SponsorBlock',
    items: [
      Switch('enableSponsorBlock', 'Enable',
        'Skip the parts of a video the community has marked, from sponsor.ajay.app',
        MONEY),
      Flags('segments', 'Segments to skip',
        'Which of SponsorBlock\u2019s categories are skipped automatically', SKIPPING,
        SEGMENTS),
      Set_('sponsorBlockManualSkips', 'Ask before skipping',
        'These segments offer a button instead of skipping on their own', SKIPPING,
        SEGMENTS.map((segment) => ({
          label: segment.label,
          value: segment.key
            .replace('enableSponsorBlock', '')
            .replace('MusicOfftopic', 'music_offtopic')
            .replace('SelfPromo', 'selfpromo')
            .toLowerCase()
        }))),
      Switch('enableSponsorBlockToasts', 'Skip notifications',
        'A message over the picture each time a segment is skipped', MESSAGE)
    ]
  },
  {
    id: 'tube_dearrow',
    title: 'DeArrow',
    items: [
      Switch('enableDeArrow', 'Enable',
        'Replace clickbait titles with ones submitted by the community, from dearrow.ajay.app',
        LOOKING),
      Switch('enableDeArrowThumbnails', 'Thumbnails',
        'Replace thumbnails as well. Slower to load over a thin connection', LOOKING)
    ]
  },
  {
    id: 'tube_playback',
    title: 'Playback',
    items: [
      Choice('preferredVideoQuality', 'Preferred quality',
        'Applied when playback starts, falling back to the next best the video has',
        SCREEN, QUALITIES, 'Quality'),
      Choice('videoPreferredCodec', 'Preferred codec',
        'Some sets decode one codec in hardware and the rest in software',
        SCREEN, CODECS, 'Codec'),
      Choice('speedSettingsIncrement', 'Speed steps',
        'How far one press moves playback speed in the speed control',
        SKIPPING, INCREMENTS, 'Step'),
      Switch('rememberPlaybackSpeed', 'Remember playback speed',
        'Carry the speed you chose into the next video. YouTube starts each one at normal '
        + 'speed', SKIPPING),
      Switch('bypassMediaSource', 'Smooth 4K playback',
        'Plays through the set\u2019s own decoder instead of the browser\u2019s. Much smoother at '
        + '2160p60. The set decodes it silently at anything but normal speed, so playback at '
        + 'another speed goes back to the ordinary player until it is set to normal again',
        SCREEN),
      Choice('nativePlaybackContainer', 'Stream description',
        'How smooth 4K playback describes the stream to the set. The same picture either '
        + 'way \u2014 sets differ in which one they play most evenly. A plain file has no '
        + 'description at all, and cannot be seeked',
        SCREEN, CONTAINERS, 'Format')
    ]
  },
  {
    id: 'tube_subtitles',
    title: 'Subtitles',
    items: [
      Switch('enableShowUserLanguage', 'Your own language',
        'Offer a subtitle track matching the interface language', SPEECH),
      Switch('enableShowOtherLanguages', 'Hidden tracks',
        'Show the tracks YouTube leaves out of the subtitle list', SPEECH)
    ]
  },
  {
    id: 'tube_player',
    title: 'Player controls',
    items: [
      Switch('enablePatchingVideoPlayer', 'Custom player controls',
        'Off leaves the row of buttons under the player exactly as YouTube built it',
        CONTROLS),
      Switch('enablePreviousNextButtons', 'Previous and next',
        'Skip between videos in a playlist from the control row', CONTROLS),
      Switch('enableSpeedControlsButton', 'Speed control',
        'Playback speed in finer steps than YouTube\u2019s own menu offers', CONTROLS),
      Switch('enableMPButton', 'Mini player', 'Shrink the video and keep browsing',
        CONTROLS),
      Switch('enableSwapMPWithPIP', 'Picture in picture instead',
        'The mini player button leaves the video over the interface rather than beside it',
        CONTROLS),
      Switch('enableSuperThanksButton', 'Super Thanks',
        'YouTube\u2019s button for paying the uploader', MONEY),
      Switch('enableAIAskButton', 'Ask',
        'YouTube\u2019s button for asking a chatbot about the video', MESSAGE)
    ]
  },
  {
    id: 'tube_interface',
    title: 'Interface',
    items: [
      Switch('enableOledTheme', 'High contrast',
        'True black instead of YouTube\u2019s near-black. Worth it on an OLED, a loss on an LCD',
        CONTRAST),
      Switch('enableFixedUI', 'Full-quality interface',
        'YouTube treats a television as a low-end device and turns animations off. This turns them back on',
        SCREEN),
      Switch('enableLongPress', 'Long press actions',
        'Hold Select on a video for save, queue and playlist actions', CONTROLS),
      Switch('enablePreviews', 'Video previews',
        'Play a preview under the cursor after a moment', SCREEN),
      Switch('enableHqThumbnails', 'High-quality thumbnails',
        'Ask for the largest thumbnail rather than the one sized for a phone', LOOKING),
      Switch('enableShorts', 'Shorts', 'Keep Shorts shelves in the feeds', SCREEN)
    ]
  },
  {
    id: 'tube_sidebar',
    title: 'Sidebar',
    items: [
      Set_('disabledSidebarContents', 'Sections',
        'Which entries the sidebar offers', CONTROLS, SIDEBAR, true),
      Switch('disableChannelsOnSidebar', 'Channels',
        'The channels you are subscribed to, listed under the sections', CONTROLS, false),
      Switch('sortSubscriptionsByAlphabet', 'Sort subscriptions A\u2013Z',
        'Alphabetical rather than the order YouTube sends', CONTROLS)
    ]
  },
  {
    id: 'tube_watched',
    title: 'Watched videos',
    items: [
      Switch('enableHideWatchedVideos', 'Hide watched videos',
        'Drop videos you have already finished out of the shelves', WATCHED),
      Choice('hideWatchedVideosThreshold', 'Counts as watched at',
        'How much of a video has to be behind you before it is hidden',
        WATCHED, PERCENTAGES, 'Watched'),
      Set_('hideWatchedVideosPages', 'Hide them on',
        'The pages hiding applies to', WATCHED, PAGES)
    ]
  },
  {
    id: 'tube_interruptions',
    title: 'Overlays and prompts',
    items: [
      Switch('hideShoppingAction', 'Shopping action',
        'The merchandise card with a QR code that YouTube lays over the picture partway through a video',
        MONEY, false),
      Switch('enableHideEndScreenCards', 'End screen cards',
        'The tiles the uploader lays over the last seconds of a video', SCREEN, false),
      Switch('enablePaidPromotionOverlay', 'Paid promotion notice',
        'YouTube\u2019s "Includes paid promotion" badge', MONEY),
      Switch('enableYouThereRenderer', 'Are you still watching?',
        'The prompt that stops playback after a long run', PRIVACY),
      Switch('enableSigninReminder', 'Sign-in reminder',
        'The prompt shown to a signed-out viewer', PRIVACY)
    ]
  },
  {
    id: 'tube_whos_watching',
    title: 'Who\u2019s watching',
    items: [
      Switch('enableWhoIsWatchingMenu', 'On startup',
        'YouTube\u2019s account picker, shown on the way in', PRIVACY),
      Switch('permanentlyEnableWhoIsWatchingMenu', 'Every time',
        'Ask again even when the app was only in the background', PRIVACY),
      Switch('enableWhosWatchingMenuOnAppExit', 'On the way out',
        'YouTube asks again when the app closes. Off puts the home button back',
        PRIVACY)
    ]
  },
  {
    id: 'tube_startup',
    title: 'Startup',
    items: [
      Switch('reloadHomeOnStartup', 'Open a page on startup',
        'Off leaves whatever was last on screen, which after a video is that video',
        RESTART),
      Choice('launchToOnStartup', 'Page to open', 'Where the app lands when it starts',
        RESTART, START_PAGES, 'Startup')
    ]
  }
];

/** The item a path — [group] or [group, item] — points at. */
function at(path) {
  const group = GROUPS[path[0]];
  if (!group) return null;
  return path.length > 1 ? group.items[path[1]] : group;
}

/** Whether a set entry is currently chosen, inversion included. */
function isChosen(item, value) {
  const stored = configRead(item.key) || [];
  const listed = stored.indexOf(value) !== -1;
  return item.invert ? !listed : listed;
}

/** The label of the chosen option of a choice. */
function chosenLabel(item) {
  const current = configRead(item.key);
  const match = item.options.find((option) => option.value === current);
  return match ? match.label : item.options[0].label;
}

// "Sponsors, intros and 4 more" reads at a glance from across a room; a count does not.
function listOf(labels, total) {
  if (labels.length === 0) return 'None';
  if (labels.length === total) return 'All';
  if (labels.length <= 2) return labels.join(' and ');
  return `${labels.slice(0, 2).join(', ')} and ${labels.length - 2} more`;
}

/** What a set or flags row says underneath its title. */
function chosenSummary(item) {
  if (item.kind === 'flags') {
    const chosen = item.options.filter((option) => configRead(option.key));
    return listOf(chosen.map((option) => option.label), item.options.length);
  }

  const chosen = item.options.filter((option) => isChosen(item, option.value));
  return listOf(chosen.map((option) => option.label), item.options.length);
}

export { GROUPS, at, isChosen, chosenLabel, chosenSummary };
