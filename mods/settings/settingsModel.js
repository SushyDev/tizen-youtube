// @ts-nocheck TODO: type-check once the sibling branches land.
import { configRead } from '../../framework/index.js';
import { SPEEDS } from '../shell/scrollSpeed.js';

const ART = 'https://www.gstatic.com/ytlr/img/';

const BLOCKING = ART + 'restricted_mode.png';
const MONEY = ART + 'purchases_and_memberships.png';
const SKIPPING = ART + 'autoplay.png';
const WATCHED = ART + 'clear_watch_history.png';
const LOOKING = ART + 'clear_search_history.png';
const SCREEN = ART + 'living_room_pre_app_user_setting.png';
const CONTROLS = ART + 'linked_devices.png';
const SPEECH = ART + 'language.png';
const PRIVACY = ART + 'privacy_and_terms.png';
const RESTART = ART + 'reset_app.png';
const MESSAGE = ART + 'send_feedback.png';

const Switch = (key, title, summary, image, on = true) =>
  ({ kind: 'switch', key, title, summary, image, on });

const Choice = (key, title, summary, image, options, prefix, note) =>
  ({ kind: 'choice', key, title, summary, image, options, prefix: prefix || title, note });

const Set_ = (key, title, summary, image, options, invert = false) =>
  ({ kind: 'set', key, title, summary, image, options, invert });

const Flags = (id, title, summary, image, options) =>
  ({ kind: 'flags', id, title, summary, image, options });

const QUALITIES = ['highest', 'auto', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p']
  .map((quality) => ({
    label: quality === 'highest' ? 'Highest available'
      : quality === 'auto' ? 'Automatic'
        : quality,
    value: quality
  }));

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

const SCROLL_SPEEDS = [{ label: 'Default', value: '' }].concat(Object.keys(SPEEDS)
  .sort((a, b) => Number(a) - Number(b))
  .map((value) => ({ label: `${value}\u00d7`, value })));

const START_PAGES = [
  { label: 'Home', value: '' },
  { label: 'Subscriptions', value: 'FEsubscriptions' },
  { label: 'Library', value: 'FElibrary' },
  { label: 'Sports', value: 'FEtopics_sports' },
  { label: 'News', value: 'FEtopics_news' },
  { label: 'Music', value: 'FEtopics_music' },
  { label: 'Podcasts', value: 'FEtopics_podcasts' },
  { label: 'Movies & TV', value: 'FEtopics_movies' },
  { label: 'Live', value: 'FEtopics_live' },
  { label: 'Gaming', value: 'FEtopics_gaming' },
  { label: 'More', value: 'FEtopics_more' }
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
        + 'speed', SKIPPING)
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
      Switch('enablePreviousNextButtons', 'Previous and next',
        'Skip between videos in a playlist from the control row', CONTROLS),
      Switch('enableMPButton', 'Mini player', 'Shrink the video and keep browsing',
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
      Switch('enableHqThumbnails', 'High-quality thumbnails',
        'Ask for the largest thumbnail rather than the one sized for a phone', LOOKING),
      Switch('enableShorts', 'Shorts', 'Keep Shorts shelves in the feeds', SCREEN),
      Choice('scrollSpeed', 'Scroll speed',
        'How fast the feed moves while a direction is held', CONTROLS,
        SCROLL_SPEEDS),
      Switch('enableRapidPress', 'Rapid press',
        'Presses made faster than the feed can move are kept rather than dropped',
        CONTROLS),
      Switch('enableSmoothNavigation', 'Smoother navigation',
        'Skip work YouTube does while you are moving. Tiles stop sliding one by one',
        SCREEN)
    ]
  },
  {
    id: 'tube_sidebar',
    title: 'Sidebar',
    items: [
      Set_('disabledSidebarContents', 'Sections',
        'Which entries the sidebar offers', CONTROLS, SIDEBAR, true)
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
      Switch('enableUpNextCard', 'Up next card',
        'The countdown to the next video, laid over the end of this one. Off stops it '
        + 'playing the next video too \u2014 the card is the only warning that it is coming',
        SKIPPING),
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
      Choice('startupPage', 'Page to open', 'Where the app lands when it starts. Home is what it does anyway',
        RESTART, START_PAGES, 'Startup')
    ]
  }
];

function at(path) {
  const group = GROUPS[path[0]];
  if (!group) return null;
  return path.length > 1 ? group.items[path[1]] : group;
}

function isChosen(item, value) {
  const stored = configRead(item.key) || [];
  const listed = stored.indexOf(value) !== -1;
  return item.invert ? !listed : listed;
}

function chosenLabel(item) {
  const current = configRead(item.key);
  const match = item.options.find((option) => option.value === current);
  return match ? match.label : item.options[0].label;
}

function listOf(labels, total) {
  if (labels.length === 0) return 'None';
  if (labels.length === total) return 'All';
  if (labels.length <= 2) return labels.join(' and ');
  return `${labels.slice(0, 2).join(', ')} and ${labels.length - 2} more`;
}

function chosenSummary(item) {
  if (item.kind === 'flags') {
    const chosen = item.options.filter((option) => configRead(option.key));
    return listOf(chosen.map((option) => option.label), item.options.length);
  }

  const chosen = item.options.filter((option) => isChosen(item, option.value));
  return listOf(chosen.map((option) => option.label), item.options.length);
}

export { GROUPS, at, isChosen, chosenLabel, chosenSummary };
