import { MenuNavigationItemRenderer, MenuServiceItemRenderer } from '../../framework/index.js';
import { say } from '../i18n/index.js';

const WATCH_LATER = 'WL';

const watchLaterRow = (data) => {
    const saved = data.watchEndpointData.playlistId === WATCH_LATER;

    return MenuServiceItemRenderer(say(saved ? 'Remove from Watch Later' : 'Save to Watch Later'), {
        clickTrackingParams: null,
        commandMetadata: {
            webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/browse/edit_playlist' }
        },
        playlistEditEndpoint: {
            playlistId: WATCH_LATER,
            actions: [saved
                ? { removedVideoId: data.videoId, action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID' }
                : { addedVideoId: data.videoId, action: 'ACTION_ADD_VIDEO' }]
        }
    });
};

// The queue draws its own shelf from these, so the whole tile travels rather than an id.
const queueRow = (data) => MenuServiceItemRenderer(say('Add to Queue'), {
    clickTrackingParams: null,
    playlistEditEndpoint: {
        customAction: { action: 'ADD_TO_QUEUE', parameters: data.item }
    }
});

const longPressData = (data) => ({
    clickTrackingParams: null,
    showMenuCommand: {
        contentId: data.videoId,
        thumbnail: { thumbnails: data.thumbnails },
        title: { simpleText: data.title },
        subtitle: { simpleText: data.subtitle },
        menu: {
            menuRenderer: {
                items: [
                    MenuNavigationItemRenderer(say('Play'), {
                        clickTrackingParams: null,
                        watchEndpoint: data.watchEndpointData
                    }),
                    watchLaterRow(data),
                    MenuNavigationItemRenderer(say('Save to Playlist'), {
                        clickTrackingParams: null,
                        addToPlaylistEndpoint: { videoId: data.videoId }
                    }),
                    queueRow(data)
                ],
                trackingParams: null,
                accessibility: { accessibilityData: { label: say('Video options') } }
            }
        }
    }
});

export { longPressData };
