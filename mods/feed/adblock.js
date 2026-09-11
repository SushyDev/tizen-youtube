import { ButtonRenderer, GRID, MenuServiceItemRenderer, PIVOT, SHELF, ShelfRenderer, TILES, TileRenderer, configRead, keepShelf, keepTile, longPressData, onRequest, onResponse, onTile, timelyAction, walkShelves, walkTiles } from '../../framework/index.js';
import { SEGMENTS } from '../sponsorblock/segments.js';
import { PatchSettings } from '../settings/nativeSettings.js';

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

    if (r.playerAds && adBlockEnabled) {
      r.playerAds = false;
    }

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

      // Only section-level advert slots are gated; the walk's keeper removes the ones inside shelves.
      if (adBlockEnabled) {
        r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
          r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.filter(
            (elm) => !elm.adSlotRenderer
          );
      }

      walkShelves(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents, SHELF);
    }

    if (
      r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
        ?.gridRenderer?.items
    ) {
      const grid = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer;
      grid.items = walkTiles(grid.items, GRID);
    }

    if (r.endscreen && configRead('enableHideEndScreenCards')) {
      r.endscreen = null;
    }

    if (r.messages && Array.isArray(r.messages) && !configRead('enableYouThereRenderer')) {
      r.messages = r.messages.filter(
        (msg) => !msg?.youThereRenderer
      );
    }

    if (!Array.isArray(r) && r?.entries && adBlockEnabled) {
      r.entries = r.entries?.filter(
        (elm) => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd
      );
    }

    PatchSettings(r);

    if (r?.contents?.sectionListRenderer?.contents) {
      walkShelves(r.contents.sectionListRenderer.contents, SHELF);
    }

    if (r?.continuationContents?.sectionListContinuation?.contents) {
      walkShelves(r.continuationContents.sectionListContinuation.contents, SHELF);
    }

    if (r?.continuationContents?.horizontalListContinuation?.items) {
      const list = r.continuationContents.horizontalListContinuation;
      list.items = walkTiles(list.items, TILES);
    }

    if (r?.continuationContents?.gridContinuation?.items) {
      const grid = r.continuationContents.gridContinuation;
      grid.items = walkTiles(grid.items, GRID);
    }

    if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
      const selectedFirstThenByTitle = (a, b) => {
        if (a.tabRenderer.selected && !b.tabRenderer.selected) return -1;
        if (!a.tabRenderer.selected && b.tabRenderer.selected) return 1;
        return a.tabRenderer.title.localeCompare(b.tabRenderer.title);
      };

      const dressTab = (tab) => {
        const content = tab.tabRenderer.content?.tvSurfaceContentRenderer?.content;
        if (content?.sectionListRenderer?.contents) walkShelves(content.sectionListRenderer.contents, SHELF);
        if (content?.gridRenderer?.items) content.gridRenderer.items = walkTiles(content.gridRenderer.items, GRID);
      };

      r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections.forEach((entry) => {
        const section = entry.tvSecondaryNavSectionRenderer;
        if (!section || !section.tabs) return;

        if (configRead('sortSubscriptionsByAlphabet')) section.tabs.sort(selectedFirstThenByTitle);

        section.tabs.forEach(dressTab);
      });
    }

    if (r?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
      if (!signinReminderEnabled) {
        r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents =
          r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.filter(
            (elm) => !elm.alertWithActionsRenderer
          );
      }
      walkShelves(r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents, PIVOT);
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
          Math.max(queuedVideosClone.findIndex(v => v.tileRenderer?.contentId === window.queuedVideos.lastVideoId), 0)
        ));
      }
    }

    if (r?.playerOverlays?.playerOverlayRenderer) {
      const overlay = r.playerOverlays.playerOverlayRenderer;

      const unwanted = configRead('hideShoppingAction')
        ? ['TIMELY_ACTION_TYPE_SHOPPING', 'TIMELY_ACTION_TYPE_NFL_WATERMARK']
        : ['TIMELY_ACTION_TYPE_NFL_WATERMARK'];

      overlay.timelyActionRenderers = (overlay.timelyActionRenderers || [])
        .filter((action) => unwanted.indexOf(action?.timelyActionRenderer?.type) === -1);

      if (configRead('sponsorBlockManualSkips').length > 0) {
        const manualSkippedSegments = configRead('sponsorBlockManualSkips');
        if (window?.sponsorblock?.segments) {
          window.sponsorblock.segments.forEach((segment) => {
            if (manualSkippedSegments.includes(segment.category)) {
              const timelyActionData = timelyAction(
                `Skip ${SEGMENTS[segment.category]?.name || segment.category}`,
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
          });
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

onRequest('playback context', ['playbackContext'], (value) => {
  const context = value.playbackContext && value.playbackContext.contentPlaybackContext;
  if (!context || context.isInlinePlaybackNoAd) return value;

  return Object.assign({}, value, {
    playbackContext: Object.assign({}, value.playbackContext, {
      contentPlaybackContext: Object.assign({}, context, { isInlinePlaybackNoAd: true })
    })
  });
});

const addPreviews = (item) => {
  if (!configRead('enablePreviews')) return;
  if (!item.tileRenderer) return;

  const watchEndpoint = item.tileRenderer.onSelectCommand;
  const copiedEndpoint = JSON.parse(JSON.stringify(watchEndpoint));
  if (item.tileRenderer?.onFocusCommand?.playbackEndpoint) return;
  if (item.tileRenderer?.onFocusCommand?.commandExecutorCommand) return;
  item.tileRenderer.onFocusCommand = {
    startInlinePlaybackCommand: {
      blockAdoption: true,
      caption: false,
      delayMs: 3000,
      durationMs: 40000,
      muted: false,
      restartPlaybackBeforeSeconds: 10,
      resumeVideo: true,
      playbackEndpoint: copiedEndpoint
    }
  };
};

// Cached per video so a held answer dresses the tile before it is drawn.
const branding = new Map();
const BRANDING_REMEMBERED = 512;

const dress = (item, videoID, data) => {
  if (!data) return;

  if (data.title) {
    item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText = data.title;
  }

  if (data.timestamp && configRead('enableDeArrowThumbnails')) {
    item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [
      {
        url: `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoID}&time=${data.timestamp}`,
        width: 1280,
        height: 640
      }
    ];
  }
};

const bestOf = (data) => {
  const title = data.titles.length
    ? data.titles.reduce((max, one) => (max.votes > one.votes ? max : one)).title
    : null;

  const thumbnail = data.thumbnails.length
    ? data.thumbnails.reduce((max, one) => (max.votes > one.votes ? max : one))
    : null;

  return { title, timestamp: thumbnail && thumbnail.timestamp };
};

const askFor = (videoID) => {
  const asked = fetch(`https://sponsor.ajay.app/api/branding?videoID=${videoID}`)
    .then((res) => res.json())
    .then((data) => {
      const best = bestOf(data);
      branding.set(videoID, best);
      return best;
    })
    .catch(() => {
      // Remembered as nothing, so a video the service will not answer for is not asked about
      // again on every scroll.
      branding.set(videoID, null);
      return null;
    });

  branding.set(videoID, asked);
  return asked;
};

const deArrowify = (item) => {
  if (!item.tileRenderer) return;
  if (!configRead('enableDeArrow')) return;

  const videoID = item.tileRenderer.contentId;
  const held = branding.get(videoID);

  // Held and settled: dress it now, inside the parse, before the tile is drawn.
  if (held !== undefined && (held === null || !held.then)) return dress(item, videoID, held);

  if (branding.size > BRANDING_REMEMBERED) branding.clear();

  const asked = held || askFor(videoID);
  asked.then((data) => dress(item, videoID, data));
};

const hqify = (item) => {
  if (!item.tileRenderer) return;
  if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') return;
  if (!configRead('enableHqThumbnails')) return;
  if (!item.tileRenderer.onSelectCommand?.watchEndpoint?.videoId) return;
  if (!item.tileRenderer.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.[0]?.url) return;

  const videoID = item.tileRenderer.onSelectCommand.watchEndpoint.videoId;
  const queryArgs = item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0].url.split('?')[1];
  item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [
    {
      url: `https://i.ytimg.com/vi/${videoID}/sddefault.jpg${queryArgs ? `?${queryArgs}` : ''}`,
      width: 640,
      height: 480
    }
  ];
};

const addLongPress = (item) => {
  if (!item.tileRenderer) return;
  if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') return;

  // A tile YouTube already gave a menu takes ours appended and never reaches the setting below —
  // "Add to Queue" belongs to the queue, not to long press.
  if (item.tileRenderer.onLongPressCommand?.showMenuCommand?.menu?.menuRenderer?.items) {
    const copiedItem = JSON.parse(JSON.stringify(item));
    item.tileRenderer.onLongPressCommand.showMenuCommand.menu.menuRenderer.items.push(MenuServiceItemRenderer('Add to Queue', {
      clickTrackingParams: null,
      playlistEditEndpoint: {
        customAction: {
          action: 'ADD_TO_QUEUE',
          parameters: copiedItem
        }
      }
    }));
    return;
  }

  if (!configRead('enableLongPress')) return;
  if (!item.tileRenderer?.metadata?.tileMetadataRenderer) return;
  if (!item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails) return;
  if (!item.tileRenderer.onSelectCommand?.watchEndpoint) return;
  const copiedItem = JSON.parse(JSON.stringify(item));
  const subtitleNode = copiedItem.tileRenderer.metadata.tileMetadataRenderer.lines?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text;
  if (!subtitleNode) return;
  const subtitle = subtitleNode;
  const data = longPressData({
    videoId: copiedItem.tileRenderer.contentId,
    thumbnails: copiedItem.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails,
    title: copiedItem.tileRenderer.metadata.tileMetadataRenderer.title.simpleText,
    subtitle: subtitle.runs ? subtitle.runs[0].text : subtitle.simpleText,
    watchEndpointData: copiedItem.tileRenderer.onSelectCommand.watchEndpoint,
    item: copiedItem
  });
  item.tileRenderer.onLongPressCommand = data;
};

const unwatched = (item) => {
  if (!item.tileRenderer) return true;
  const progressBar = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays?.find(overlay => overlay.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer;
  if (!progressBar) return true;
  if (!configRead('enableHideWatchedVideos')) return true;
  const pages = configRead('hideWatchedVideosPages');
  if (!pages.length) return true;
  // Read per tile rather than per response: the hash can move under a walk.
  const hash = location.hash.substring(1);
  const pageName = hash === '/' ? 'home' : hash.startsWith('/search') ? 'search' : hash.split('?')[1]?.split('&')[0]?.split('=')[1]?.replace('FE', '')?.replace('topics_', '') ?? '';
  if (!pages.includes(pageName)) return true;

  const percentWatched = (progressBar.percentDurationWatched || 0);
  return percentWatched <= configRead('hideWatchedVideosThreshold');
};

const notAShortTile = (item) => {
  if (configRead('enableShorts')) return true;
  if (item.tileRenderer?.tvhtml5ShelfRendererType === 'TVHTML5_TILE_RENDERER_TYPE_SHORTS') return false;
  return !item.tileRenderer?.onSelectCommand?.reelWatchEndpoint;
};

const notAShortsShelf = (shelf) => {
  if (configRead('enableShorts')) return true;
  return shelf.shelfRenderer.tvhtml5ShelfRendererType !== 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS';
};

onTile('deArrow', [SHELF, PIVOT, TILES, GRID], deArrowify);
onTile('hq thumbnails', [SHELF, PIVOT, TILES, GRID], hqify);
onTile('long press', [SHELF, PIVOT, TILES, GRID], addLongPress);

onTile('previews', [SHELF], addPreviews);

keepTile('advert slots', [SHELF, PIVOT, TILES, GRID], (item) => !item.adSlotRenderer);
keepTile('watched', [SHELF, PIVOT, TILES, GRID], unwatched);
keepTile('shorts tiles', [SHELF, PIVOT, GRID], notAShortTile);
keepShelf('shorts shelves', [SHELF, PIVOT], notAShortsShelf);
