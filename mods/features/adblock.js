import { configRead } from '../config.js';
import { SEGMENTS } from './segments.js';
import { onResponse, onRequest } from '../youtube/json.js';

import { timelyAction, longPressData, MenuServiceItemRenderer, ShelfRenderer, TileRenderer, ButtonRenderer } from '../ui/ytUI.js';
import { PatchSettings } from '../ui/nativeSettings.js';

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

      if (adBlockEnabled) {
        r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
          r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.filter(
            (elm) => !elm.adSlotRenderer
          );

        r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.forEach((shelve) => {
          if (shelve.shelfRenderer && shelve.shelfRenderer.content?.horizontalListRenderer?.items) {
            shelve.shelfRenderer.content.horizontalListRenderer.items =
              shelve.shelfRenderer.content.horizontalListRenderer.items.filter(
                (item) => !item.adSlotRenderer
              );
          }
        });
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

    if (!Array.isArray(r) && r?.entries && adBlockEnabled) {
      r.entries = r.entries?.filter(
        (elm) => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd
      );
    }

    PatchSettings(r);

    if (r?.contents?.sectionListRenderer?.contents) {
      processShelves(r.contents.sectionListRenderer.contents);
    }

    if (r?.continuationContents?.sectionListContinuation?.contents) {
      processShelves(r.continuationContents.sectionListContinuation.contents);
    }

    if (r?.continuationContents?.horizontalListContinuation?.items) {
      deArrowify(r.continuationContents.horizontalListContinuation.items);
      hqify(r.continuationContents.horizontalListContinuation.items);
      addLongPress(r.continuationContents.horizontalListContinuation.items);
      r.continuationContents.horizontalListContinuation.items = hideVideo(r.continuationContents.horizontalListContinuation.items);
    }

    if (r?.continuationContents?.gridContinuation?.items) {
      addLongPress(r.continuationContents.gridContinuation.items);
    }

    if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
      const selectedFirstThenByTitle = (a, b) => {
        if (a.tabRenderer.selected && !b.tabRenderer.selected) return -1;
        if (!a.tabRenderer.selected && b.tabRenderer.selected) return 1;
        return a.tabRenderer.title.localeCompare(b.tabRenderer.title);
      };

      const dressTab = (tab) => {
        const content = tab.tabRenderer.content?.tvSurfaceContentRenderer?.content;
        if (content?.sectionListRenderer?.contents) processShelves(content.sectionListRenderer.contents);
        if (content?.gridRenderer?.items) addLongPress(content.gridRenderer.items);
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

function processShelves(shelves, shouldAddPreviews = true) {
  const isShortsShelf = (shelve) => shelve.shelfRenderer?.content?.horizontalListRenderer?.items
    && shelve.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS';
  const shorts = configRead('enableShorts') ? [] : shelves.filter(isShortsShelf);

  shelves.forEach((shelve) => {
    if (shelve.shelfRenderer) {
      if (!shelve.shelfRenderer.content?.horizontalListRenderer?.items) return;
      deArrowify(shelve.shelfRenderer.content.horizontalListRenderer.items);
      hqify(shelve.shelfRenderer.content.horizontalListRenderer.items);
      addLongPress(shelve.shelfRenderer.content.horizontalListRenderer.items);
      if (shouldAddPreviews) {
        addPreviews(shelve.shelfRenderer.content.horizontalListRenderer.items);
      }
      shelve.shelfRenderer.content.horizontalListRenderer.items = hideVideo(shelve.shelfRenderer.content.horizontalListRenderer.items);
      if (!configRead('enableShorts')) {
        if (shorts.indexOf(shelve) !== -1) return;
        shelve.shelfRenderer.content.horizontalListRenderer.items = shelve.shelfRenderer.content.horizontalListRenderer.items.filter(item => item.tileRenderer?.tvhtml5ShelfRendererType !== 'TVHTML5_TILE_RENDERER_TYPE_SHORTS');

        shelve.shelfRenderer.content.horizontalListRenderer.items = shelve.shelfRenderer.content.horizontalListRenderer.items.filter(item => !item.tileRenderer?.onSelectCommand?.reelWatchEndpoint);
      }
    }
  });

  shorts.forEach((shelve) => shelves.splice(shelves.indexOf(shelve), 1));
}

function addPreviews(items) {
  if (!configRead('enablePreviews')) return;
  items.forEach((item) => {
    if (item.tileRenderer) {
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
    }
  });
}

function deArrowify(items) {
  items.filter((item) => item.adSlotRenderer)
    .forEach((advert) => items.splice(items.indexOf(advert), 1));

  items.forEach((item) => {
    if (!item.tileRenderer) return;
    if (configRead('enableDeArrow')) {
      const videoID = item.tileRenderer.contentId;
      fetch(`https://sponsor.ajay.app/api/branding?videoID=${videoID}`).then(res => res.json()).then(data => {
        if (data.titles.length > 0) {
          const mostVoted = data.titles.reduce((max, title) => max.votes > title.votes ? max : title);
          item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText = mostVoted.title;
        }

        if (data.thumbnails.length > 0 && configRead('enableDeArrowThumbnails')) {
          const mostVotedThumbnail = data.thumbnails.reduce((max, thumbnail) => max.votes > thumbnail.votes ? max : thumbnail);
          if (mostVotedThumbnail.timestamp) {
            item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [
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
  });
}

function hqify(items) {
  items.forEach((item) => {
    if (!item.tileRenderer) return;
    if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') return;
    if (configRead('enableHqThumbnails')) {
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
    }
  });
}

function addLongPress(items) {
  items.forEach((item) => {
    if (!item.tileRenderer) return;
    if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') return;
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
  });
}

function hideVideo(items) {
  return items.filter(item => {
    if (!item.tileRenderer) return true;
    const progressBar = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays?.find(overlay => overlay.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer;
    if (!progressBar) return true;
    if (!configRead('enableHideWatchedVideos')) return true;
    const pages = configRead('hideWatchedVideosPages');
    if (!pages.length) return true;
    const hash = location.hash.substring(1);
    const pageName = hash === '/' ? 'home' : hash.startsWith('/search') ? 'search' : hash.split('?')[1]?.split('&')[0]?.split('=')[1]?.replace('FE', '')?.replace('topics_', '') ?? '';
    if (!pages.includes(pageName)) return true;

    const percentWatched = (progressBar.percentDurationWatched || 0);
    return percentWatched <= configRead('hideWatchedVideosThreshold');
  });
}
