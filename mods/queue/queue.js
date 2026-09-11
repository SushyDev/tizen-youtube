window.queuedVideos = {
    videos: [],
    lastVideoId: null
};

import { resolve as resolveCommand, whenPlayer } from '../../framework/index.js';

function addListener() {
    whenPlayer('queue', (videoPlayer) => {
        videoPlayer.addEventListener('onStateChange', () => {
            const playerStateObject = videoPlayer.getPlayerStateObject();
            const videoData = videoPlayer.getVideoData();
            if (window.queuedVideos.videos.length === 0) return;
            if (playerStateObject.isEnded) {
                const index = window.queuedVideos.videos.findIndex(v => v.tileRenderer.contentId === videoData.video_id);
                if (index !== -1) {
                    if (index + 1 >= window.queuedVideos.videos.length) {
                        resolveCommand({
                            customAction: {
                                action: 'CLEAR_QUEUE'
                            }
                        });
                        return;
                    }
                    const videoWatchEndpoint = window.queuedVideos.videos[index + 1].tileRenderer.onSelectCommand;
                    setTimeout(() => resolveCommand(videoWatchEndpoint), 500);
                } else if (window.queuedVideos.lastVideoId) {
                    const lastIndex = window.queuedVideos.videos.findIndex(v => v.tileRenderer.contentId === window.queuedVideos.lastVideoId);
                    if (lastIndex !== -1 && lastIndex + 1 < window.queuedVideos.videos.length) {
                        const videoWatchEndpoint = window.queuedVideos.videos[lastIndex + 1].tileRenderer.onSelectCommand;
                        setTimeout(() => resolveCommand(videoWatchEndpoint), 500);
                    } else {
                        resolveCommand({
                            customAction: {
                                action: 'CLEAR_QUEUE'
                            }
                        });
                        return;
                    }
                } else {
                    const videoWatchEndpoint = window.queuedVideos.videos[0].tileRenderer.onSelectCommand;
                    setTimeout(() => resolveCommand(videoWatchEndpoint), 500);
                }
            } else if (playerStateObject.isPlaying) {
                document.getElementById('container').style.setProperty('opacity', '1', 'important');
                if (window.queuedVideos.videos.find(v => v.tileRenderer?.contentId === videoData.video_id)) {
                    window.queuedVideos.lastVideoId = videoData.video_id;
                }
            }
        });
    });
}

addListener();
