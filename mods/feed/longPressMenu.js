import { MenuNavigationItemRenderer, MenuServiceItemRenderer } from '../../framework/index.js';

// What holding Select on a video tile offers.
//
// Separate from the mod that attaches it: this is the four choices, and longPress.js is when a
// tile gets them. The container already puts a menu on most tiles, so this whole shape is only
// built for the ones it leaves bare.

const WATCH_LATER = 'WL';

// The same row toggles: on a tile already in Watch Later it removes, everywhere else it adds.
const watchLaterRow = (data) => {
    const saved = data.watchEndpointData.playlistId === WATCH_LATER;

    return MenuServiceItemRenderer(saved ? 'Remove from Watch Later' : 'Save to Watch Later', {
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

// Add to Queue carries the whole tile rather than an id: the queue draws its own shelf from these,
// and re-fetching a tile it was already handed would be a request per long press.
const queueRow = (data) => MenuServiceItemRenderer('Add to Queue', {
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
                    MenuNavigationItemRenderer('Play', {
                        clickTrackingParams: null,
                        watchEndpoint: data.watchEndpointData
                    }),
                    watchLaterRow(data),
                    MenuNavigationItemRenderer('Save to Playlist', {
                        clickTrackingParams: null,
                        addToPlaylistEndpoint: { videoId: data.videoId }
                    }),
                    queueRow(data)
                ],
                trackingParams: null,
                accessibility: { accessibilityData: { label: 'Video options' } }
            }
        }
    }
});

export { longPressData };
