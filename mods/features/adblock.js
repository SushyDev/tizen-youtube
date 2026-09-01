import { configRead } from '../config.js';
import { onResponse, onRequest } from '../youtube/json.js';

import { timelyAction, longPressData, MenuServiceItemRenderer, ShelfRenderer, TileRenderer, ButtonRenderer } from '../ui/ytUI.js';
import { PatchSettings } from '../ui/nativeSettings.js';
import { cloneJson } from '../utils/clone.js';

// What each SponsorBlock category is called on the skip button. The ids come from
// the API, so an unknown one falls back to the id itself.
const SEGMENT_NAMES = {
  sponsor: 'sponsored segment',
  intro: 'intro',
  outro: 'outro',
  interaction: 'interaction reminder',
  selfpromo: 'self-promotion',
  preview: 'recap or preview',
  filler: 'tangents',
  music_offtopic: 'non-music part',
  poi_highlight: 'highlight'
};

// A minimal reimplementation of the uBlock Origin rule at
// https://github.com/uBlockOrigin/uAssets/blob/3497eeb/filters/filters.txt#L116 —
// dropping adPlacements is enough for YouTube TV. RESPONSE_KEYS are the top-level keys
// that mean "worth reading"; everything else is rejected on one lookup.
const RESPONSE_KEYS = [
  'adPlacements', 'adSlots', 'contents', 'continuationContents', 'endscreen',
  'entries', 'frameworkUpdates', 'items', 'messages', 'paidContentOverlay',
  'playbackContext', 'playerAds', 'playerOverlays', 'streamingData',
  'transportControls'
];

onResponse('ads and shelves', RESPONSE_KEYS, (r) => {
  {
    const adBlockEnabled = configRead('enableAdBlock');
    const signinReminderEnabled = configRead('enableSigninReminder');

    if (r.adPlacements && adBlockEnabled) {
      r.adPlacements = [];
    }

    // playerAds too, just in case.
    if (r.playerAds && adBlockEnabled) {
      r.playerAds = false;
    }

    // Emptying adPlacements alone is not enough.
    if (r.adSlots && adBlockEnabled) {
      r.adSlots = [];
    }

    if (r.paidContentOverlay && !configRead('enablePaidPromotionOverlay')) {
      r.paidContentOverlay = null;
    }

    if (r?.streamingData?.adaptiveFormats && configRead('videoPreferredCodec') !== 'any') {
      const preferredCodec = configRead('videoPreferredCodec');
      const hasPreferredCodec = r.streamingData.adaptiveFormats.find(format => format.mimeType.includes(preferredCodec));
      if (hasPreferredCodec) {
        r.streamingData.adaptiveFormats = r.streamingData.adaptiveFormats.filter(format => {
          if (format.mimeType.startsWith('audio/')) return true;
          return format.mimeType.includes(preferredCodec);
        });
      }
    }

    // Drop "masthead" ad from home screen
    if (
      r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
        ?.sectionListRenderer?.contents
    ) {
      if (!signinReminderEnabled) {
        r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
          r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.filter(
            (elm) => !elm.feedNudgeRenderer
          );
      }

      if (adBlockEnabled) {
        r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
          r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.filter(
            (elm) => !elm.adSlotRenderer
          );

        for (const shelve of r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents) {
          if (shelve.shelfRenderer && shelve.shelfRenderer.content?.horizontalListRenderer?.items) {
            shelve.shelfRenderer.content.horizontalListRenderer.items =
              shelve.shelfRenderer.content.horizontalListRenderer.items.filter(
                (item) => !item.adSlotRenderer
              );
          }
        }
      }

      processShelves(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents);
    }

    if (
      r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
        ?.gridRenderer?.items
    ) {
      addLongPress(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items);
    }

    if (r.endscreen && configRead('enableHideEndScreenCards')) {
      r.endscreen = null;
    }

    if (r.messages && Array.isArray(r.messages) && !configRead('enableYouThereRenderer')) {
      r.messages = r.messages.filter(
        (msg) => !msg?.youThereRenderer
      );
    }

    // Remove shorts ads
    if (!Array.isArray(r) && r?.entries && adBlockEnabled) {
      r.entries = r.entries?.filter(
        (elm) => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd
      );
    }

    // This app's own settings, as rows on YouTube's settings page.

    PatchSettings(r);

    // DeArrow, done here rather than by DOM manipulation.

    if (r?.contents?.sectionListRenderer?.contents) {
      processShelves(r.contents.sectionListRenderer.contents);
    }

    if (r?.continuationContents?.sectionListContinuation?.contents) {
      processShelves(r.continuationContents.sectionListContinuation.contents);
    }

    if (r?.continuationContents?.horizontalListContinuation?.items) {
      r.continuationContents.horizontalListContinuation.items =
        decorateTiles(r.continuationContents.horizontalListContinuation.items, tileOptions(false));
    }

    if (r?.continuationContents?.gridContinuation?.items) {
      addLongPress(r.continuationContents.gridContinuation.items);
    }

    if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
      for (let i = 0; i < r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections.length; i++) {
        const section = r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections[i].tvSecondaryNavSectionRenderer;
        if (!section || !section.tabs) continue;

        if (configRead('sortSubscriptionsByAlphabet')) {
          section.tabs.sort((a, b) => {
            if (a.tabRenderer.selected && !b.tabRenderer.selected) return -1;
            if (!a.tabRenderer.selected && b.tabRenderer.selected) return 1;
            return a.tabRenderer.title.localeCompare(b.tabRenderer.title);
          });
        }

        for (let j = 0; j < section.tabs.length; j++) {
          const tab = section.tabs[j];
          const content = tab.tabRenderer.content?.tvSurfaceContentRenderer?.content;
          if (content?.sectionListRenderer?.contents) {
            const index = section.tabs.indexOf(tab);
            const clone = content.sectionListRenderer.contents;
            processShelves(clone);
            section.tabs[index].tabRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents = clone;
          }
          if (content?.gridRenderer?.items) {
            addLongPress(content.gridRenderer.items);
          }
        }
      }
    }

    if (r?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
      if (!signinReminderEnabled) {
        r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents =
          r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.filter(
            (elm) => !elm.alertWithActionsRenderer
          );
      }
      processShelves(r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents, false);
      if (window.queuedVideos.videos.length > 0) {
        const queuedVideosClone = window.queuedVideos.videos.slice();
        queuedVideosClone.unshift(TileRenderer(
          'Clear Queue',
          {
            customAction: {
              action: 'CLEAR_QUEUE'
            }
          }));
        r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.unshift(ShelfRenderer(
          'Queued Videos',
          queuedVideosClone,
          queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId) !== -1 ?
            queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId)
            : 0
        ));
      }
    }
    // Manual SponsorBlock Skips

    if (r?.playerOverlays?.playerOverlayRenderer) {
      const overlay = r.playerOverlays.playerOverlayRenderer;

      // A timely action is a card YouTube lays over the picture partway through a
      // video. The shopping one sells merchandise behind a QR code; the watermark is
      // a broadcaster's logo. Both go, and the array is left in place either way
      // because the SponsorBlock skip buttons below are pushed onto it.
      const unwanted = configRead('hideShoppingAction')
        ? ['TIMELY_ACTION_TYPE_SHOPPING', 'TIMELY_ACTION_TYPE_NFL_WATERMARK']
        : ['TIMELY_ACTION_TYPE_NFL_WATERMARK'];

      overlay.timelyActionRenderers = (overlay.timelyActionRenderers || [])
        .filter((action) => unwanted.indexOf(action?.timelyActionRenderer?.type) === -1);

      if (configRead('sponsorBlockManualSkips').length > 0) {
        const manualSkippedSegments = configRead('sponsorBlockManualSkips');
        if (window?.sponsorblock?.segments) {
          for (const segment of window.sponsorblock.segments) {
            if (manualSkippedSegments.includes(segment.category)) {
              const timelyActionData = timelyAction(
                `Skip ${SEGMENT_NAMES[segment.category] || segment.category}`,
                'SKIP_NEXT',
                {
                  clickTrackingParams: null,
                  showEngagementPanelEndpoint: {
                    customAction: {
                      action: 'SKIP',
                      parameters: {
                        time: segment.segment[1]
                      }
                    }
                  }
                },
                segment.segment[0] * 1000,
                segment.segment[1] * 1000 - segment.segment[0] * 1000
              );
              overlay.timelyActionRenderers.push(timelyActionData);
            }
          }
        }
      }
    }

    if (r?.transportControls?.transportControlsRenderer?.promotedActions && configRead('enableSponsorBlockHighlight')) {
      if (window?.sponsorblock?.segments) {
        const category = window.sponsorblock.segments.find(seg => seg.category === 'poi_highlight');
        if (category) {
          r.transportControls.transportControlsRenderer.promotedActions.push({
            type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPONSORBLOCK_HIGHLIGHT',
            button: {
              buttonRenderer: ButtonRenderer(
                false,
                'Skip to highlight',
                'SKIP_NEXT',
                {
                  clickTrackingParams: null,
                  customAction: {
                    action: 'SKIP',
                    parameters: {
                      time: category.segment[0]
                    }
                  }
                })
            }
          });
        }
      }
    }
  }
});

// Telling the server this playback is ad-free before it decides what to send. A copy
// rather than an edit in place: the object is YouTube's and is reused across requests.
onRequest('playback context', ['playbackContext'], (value) => {
  const context = value.playbackContext && value.playbackContext.contentPlaybackContext;
  if (!context || context.isInlinePlaybackNoAd) return value;

  return Object.assign({}, value, {
    playbackContext: Object.assign({}, value.playbackContext, {
      contentPlaybackContext: Object.assign({}, context, { isInlinePlaybackNoAd: true })
    })
  });
});

// Every setting a tile pass needs, read once. These used to be read per tile, per pass —
// `hideVideo` alone re-read two settings and re-derived the page name from
// `location.hash` for every item in every shelf.
function tileOptions(shouldAddPreviews) {
  const pages = configRead('hideWatchedVideosPages');
  let hideWatched = false;

  if (pages.length) {
    const hash = location.hash.substring(1);
    const pageName = hash === '/' ? 'home' : hash.startsWith('/search') ? 'search' : hash.split('?')[1]?.split('&')[0]?.split('=')[1]?.replace('FE', '')?.replace('topics_', '') ?? '';
    hideWatched = pages.includes(pageName);
  }

  return {
    deArrow: configRead('enableDeArrow'),
    deArrowThumbnails: configRead('enableDeArrowThumbnails'),
    hqThumbnails: configRead('enableHqThumbnails'),
    longPress: configRead('enableLongPress'),
    previews: shouldAddPreviews && configRead('enablePreviews'),
    hideWatched,
    watchedThreshold: configRead('hideWatchedVideosThreshold')
  };
}

/** True when a tile is watched past the threshold and this surface hides those. */
function isWatched(tile, options) {
  if (!options.hideWatched) return false;

  const progressBar = tile.header?.tileHeaderRenderer?.thumbnailOverlays
    ?.find(overlay => overlay.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer;

  if (!progressBar) return false;

  return (progressBar.percentDurationWatched || 0) > options.watchedThreshold;
}

// One walk of the items array. This was five — deArrowify, hqify, addLongPress,
// addPreviews and hideVideo each iterated the same array with their own tileRenderer
// guard and their own per-item `configRead`. Hiding is decided first so nothing is spent
// decorating a tile that is about to be dropped.
function decorateTiles(items, options) {
  const kept = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Adverts. The old code spliced this array while iterating it with `for...of`,
    // which skipped the element after every advert it removed.
    if (item.adSlotRenderer) continue;

    const tile = item.tileRenderer;
    if (!tile) {
      kept.push(item);
      continue;
    }

    if (isWatched(tile, options)) continue;

    // Thumbnails and long-press only ever applied to the default tile style; DeArrow
    // and previews never checked it. Keeping that as it was.
    const styled = tile.style === 'TILE_STYLE_YTLR_DEFAULT';

    if (options.deArrow) deArrowTile(tile, options);
    if (options.hqThumbnails && styled) hqTile(tile);
    if (styled) longPressTile(item, tile, options);
    if (options.previews) previewTile(tile);

    kept.push(item);
  }

  return kept;
}

function processShelves(shelves, shouldAddPreviews = true) {
  const options = tileOptions(shouldAddPreviews);
  const shorts = configRead('enableShorts');

  for (const shelve of shelves) {
    if (shelve.shelfRenderer) {
      if (!shelve.shelfRenderer.content?.horizontalListRenderer?.items) continue;

      shelve.shelfRenderer.content.horizontalListRenderer.items =
        decorateTiles(shelve.shelfRenderer.content.horizontalListRenderer.items, options);

      if (!shorts) {
        if (shelve.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') {
          shelves.splice(shelves.indexOf(shelve), 1);
          continue;
        }
        shelve.shelfRenderer.content.horizontalListRenderer.items = shelve.shelfRenderer.content.horizontalListRenderer.items.filter(item => item.tileRenderer?.tvhtml5ShelfRendererType !== 'TVHTML5_TILE_RENDERER_TYPE_SHORTS');

        shelve.shelfRenderer.content.horizontalListRenderer.items = shelve.shelfRenderer.content.horizontalListRenderer.items.filter(item => !item.tileRenderer?.onSelectCommand?.reelWatchEndpoint);
      }
    }
  }
}

function previewTile(tile) {
  const watchEndpoint = tile.onSelectCommand;
  if (tile.onFocusCommand?.playbackEndpoint) return;
  if (tile.onFocusCommand?.commandExecutorCommand) return;

  tile.onFocusCommand = {
    startInlinePlaybackCommand: {
      blockAdoption: true,
      caption: false,
      delayMs: 3000,
      durationMs: 40000,
      muted: false,
      restartPlaybackBeforeSeconds: 10,
      resumeVideo: true,
      playbackEndpoint: cloneJson(watchEndpoint)
    }
  };
}

function deArrowTile(tile, options) {
  const videoID = tile.contentId;

  fetch(`https://sponsor.ajay.app/api/branding?videoID=${videoID}`).then(res => res.json()).then(data => {
    if (data.titles.length > 0) {
      const mostVoted = data.titles.reduce((max, title) => max.votes > title.votes ? max : title);
      tile.metadata.tileMetadataRenderer.title.simpleText = mostVoted.title;
    }

    if (data.thumbnails.length > 0 && options.deArrowThumbnails) {
      const mostVotedThumbnail = data.thumbnails.reduce((max, thumbnail) => max.votes > thumbnail.votes ? max : thumbnail);
      if (mostVotedThumbnail.timestamp) {
        tile.header.tileHeaderRenderer.thumbnail.thumbnails = [
          {
            url: `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoID}&time=${mostVotedThumbnail.timestamp}`,
            width: 1280,
            height: 640
          }
        ]
      }
    }
  }).catch(() => { });
}

function hqTile(tile) {
  if (!tile.onSelectCommand?.watchEndpoint?.videoId) return;
  if (!tile.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.[0]?.url) return;

  const videoID = tile.onSelectCommand.watchEndpoint.videoId;
  const queryArgs = tile.header.tileHeaderRenderer.thumbnail.thumbnails[0].url.split('?')[1];

  tile.header.tileHeaderRenderer.thumbnail.thumbnails = [
    {
      url: `https://i.ytimg.com/vi/${videoID}/sddefault.jpg${queryArgs ? `?${queryArgs}` : ''}`,
      width: 640,
      height: 480
    }
  ];
}

// What the queue keeps when a tile is added to it. The queue renders its entries as a
// shelf of real tiles, so this has to be a tile — but never this tile's own long-press
// menu, for two reasons. It is the thing being mutated immediately below, so a snapshot
// taken after the push would contain a menu item whose `parameters` is the snapshot
// itself: a cycle, which throws the first time anything serialises the response and
// recurses forever in any deep copy. And a queued entry has no use for it. Dropping it
// is also most of what made the old whole-tile clone expensive.
function tileSnapshot(item) {
    const snapshot = {};

    for (const key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        if (key !== 'tileRenderer') {
            snapshot[key] = cloneJson(item[key]);
            continue;
        }

        const tile = {};
        for (const field in item.tileRenderer) {
            if (!Object.prototype.hasOwnProperty.call(item.tileRenderer, field)) continue;
            if (field === 'onLongPressCommand') continue;
            tile[field] = cloneJson(item.tileRenderer[field]);
        }
        snapshot.tileRenderer = tile;
    }

    return snapshot;
}

function longPressTile(item, tile, options) {
  // A tile YouTube already gives a menu to only needs the queue entry adding to it.
  if (tile.onLongPressCommand?.showMenuCommand?.menu?.menuRenderer?.items) {
    tile.onLongPressCommand.showMenuCommand.menu.menuRenderer.items.push(MenuServiceItemRenderer('Add to Queue', {
      clickTrackingParams: null,
      playlistEditEndpoint: {
        customAction: {
          action: 'ADD_TO_QUEUE',
          parameters: tileSnapshot(item)
        }
      }
    }));
    return;
  }

  if (!options.longPress) return;
  if (!tile.metadata?.tileMetadataRenderer) return;
  if (!tile.header?.tileHeaderRenderer?.thumbnail?.thumbnails) return;
  if (!tile.onSelectCommand?.watchEndpoint) return;

  const subtitle = tile.metadata.tileMetadataRenderer.lines?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text;
  if (!subtitle) return;

  // Read straight off the tile. This used to deep-clone the whole thing first and then
  // read every field off the copy, including the one that decides whether any of it was
  // needed. `item` goes in live for the same reason as above.
  tile.onLongPressCommand = longPressData({
    videoId: tile.contentId,
    thumbnails: tile.header.tileHeaderRenderer.thumbnail.thumbnails,
    title: tile.metadata.tileMetadataRenderer.title.simpleText,
    subtitle: subtitle.runs ? subtitle.runs[0].text : subtitle.simpleText,
    watchEndpointData: tile.onSelectCommand.watchEndpoint,
    item: tileSnapshot(item)
  });
}

// The grid surfaces want the long-press entry and nothing else.
function addLongPress(items) {
  const options = tileOptions(false);

  for (let i = 0; i < items.length; i++) {
    const tile = items[i].tileRenderer;
    if (!tile) continue;
    if (tile.style !== 'TILE_STYLE_YTLR_DEFAULT') continue;
    longPressTile(items[i], tile, options);
  }
}
