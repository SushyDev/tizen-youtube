import { configRead } from '../config.js';
import { onResponse } from '../youtube/json.js';
import { replaceMediaSource } from '../youtube/mediaSource.js';

// Points the player at a stream the service serves rather than at its own MediaSource.
// Same decoder, same element, same media: through MediaSource this hardware drops frames at
// 2160p60 and from a URL it drops none. The player keeps its interface and keeps driving
// playback; it is just not the thing feeding the decoder.

const SERVICE = `${window.location.origin}/dash`;

// Where the player is pointed, from the first moment it asks. The stream behind it is still
// opening then, so the service holds the request — a short wait reads as loading, where
// playing something else first and swapping reads as a black screen and a spinner.
const manifestFor = (videoId) => `${SERVICE}/by-video/${encodeURIComponent(videoId)}/manifest.mpd`;

// How often the player is asked what the viewer has settled on. Quality, audio track,
// stable volume and voice boost are all a different format underneath, so one check covers
// every one of them.
const WATCH_EVERY = 2000;

// A change has to read the same this many times before it is acted on, and one cannot
// follow another sooner than the cooldown. Acting on a video restarts it.
const STEADY_READS = 2;
const COOLDOWN = 12000;

// How many times a video may be handed our address before we stop offering it. A player
// that cannot play what it is given asks again, and again: without a limit the page spends
// its life attaching to a stream that will never work instead of falling back to the one
// that always does.
const MOST_ATTEMPTS = 3;

// Streams the service is holding for us, by video. The page asks about more than one — it
// loads responses for what it might play next — and which one the player is actually
// setting up for is only known when it asks for a URL.
const opened = new Map();

// How many times each has been handed over, so a stream that never plays is given up on.
const attempts = new Map();

// Set when a change is what caused the video to be loaded again, so the service knows to
// wait for the player to say what was chosen rather than reading the previous answer.
const changed = new Set();

// What is being served for the video now playing, so a change can be seen.
let serving = null;

/** What the player says it is loading. */
function playerVideo() {
    try {
        const player = document.querySelector('#movie_player, .html5-video-player');
        const data = player && player.getVideoData && player.getVideoData();
        return (data && data.video_id) || null;
    } catch (e) {
        return null;
    }
}

/** What the page's address says is being watched. */
function routeVideo() {
    const match = /[?&]v=([^&#]+)/.exec(window.location.hash || '');
    return match ? decodeURIComponent(match[1]) : null;
}

/**
 * The video the player is attaching a source for, when both the player and the address
 * agree about it.
 *
 * They can disagree for a moment while one video is replacing another, and the cost of
 * being wrong is not symmetric: guessing wrong hands the player a different video than the
 * one asked for, while giving up means the page plays the way it always did.
 */
function attachingTo() {
    const fromPlayer = playerVideo();
    const fromRoute = routeVideo();

    if (fromPlayer && fromRoute && fromPlayer !== fromRoute) return null;
    return fromPlayer || fromRoute;
}

function closeSession(id) {
    return fetch(`${SERVICE}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    }).catch(() => { /* the service sweeps what it is not told about */ });
}

const player = () => document.querySelector('#movie_player, .html5-video-player');

/** Whether the element is playing what the service is serving. */
function playingOurs() {
    const video = document.querySelector('video');
    return Boolean(video && video.readyState >= 2 && String(video.currentSrc).indexOf('/dash/') !== -1);
}

/**
 * Follows what the viewer changes. Quality, audio track, stable volume and voice boost are
 * each a different format underneath, so watching the format watches all four.
 *
 * The change is applied by asking the player to load the video again at the moment it is
 * at. Nothing here touches the element: it is the player's, and reaching past it to change
 * what it is playing is what leaves its controls out of step with the picture.
 */
function watch() {
    if (watch.timer) clearInterval(watch.timer);

    let steady = null;
    let reads = 0;
    let movedAt = 0;

    watch.timer = setInterval(() => {
        if (!serving || serving.videoId !== attachingTo()) return;

        // Nothing to follow while nothing is playing. A stream that has not started is a
        // problem of its own, and restarting the video over it would turn it into a loop.
        if (!playingOurs()) return;

        const track = audioXtags();

        // Sound only. The player's quality is its own adaptive choice, not the viewer's:
        // with a source that never reports a network it settles wherever it likes and stays
        // there, so comparing it against what is being served disagrees for ever and
        // restarts the video every time it is asked.
        const wrongSound = typeof track === 'string' && (serving.audio.xtags || '') !== track;
        const change = wrongSound ? String(track) : null;

        if (!change) { steady = null; reads = 0; return; }
        if (change !== steady) { steady = change; reads = 1; return; }
        if (++reads < STEADY_READS) return;
        if (Date.now() - movedAt < COOLDOWN) return;

        movedAt = Date.now();
        steady = null;
        reads = 0;

        changed.add(serving.videoId);

        const video = document.querySelector('video');
        const at = video ? video.currentTime : 0;

        console.log(`[nativePlayback] the viewer changed the audio track to ${JSON.stringify(track)}`);

        // The player's own way of starting a video again. It rebuilds its source as it
        // does, which is when it asks for an address and gets the new stream.
        try {
            player().loadVideoById(serving.videoId, at);
        } catch (e) {
            console.error(`[nativePlayback] could not restart the video: ${e.message}`);
        }
    }, WATCH_EVERY);
}

/** Everything but this one is media nobody is watching, still being fetched. */
function keepOnly(videoId) {
    opened.forEach((id, held) => {
        if (held === videoId) return;

        opened.delete(held);
        if (id) closeSession(id);
    });
}

/** Everything the service needs to fetch the same media the page was given. */
function sessionFrom(response) {
    const streaming = response.streamingData || {};
    const ustreamer = ((response.playerConfig || {}).mediaCommonConfig || {})
        .mediaUstreamerRequestConfig;

    return {
        videoId: (response.videoDetails || {}).videoId,
        formats: streaming.adaptiveFormats || [],
        durationMs: Number((response.videoDetails || {}).lengthSeconds || 0) * 1000,
        ustreamerConfig: ustreamer && ustreamer.videoPlaybackUstreamerConfig
    };
}

/** Whether this is a response the picture can be taken over for. */
function playable(request) {
    if (!request.videoId || !request.ustreamerConfig) return false;
    if (!request.formats.length) return false;

    // Live reports no length and has no fixed segment index, so there is nothing to
    // describe and nothing to serve.
    return request.durationMs > 0;
}

/** The audio track the player is playing, which is the viewer's answer and not a guess. */
function audioXtags() {
    try {
        const track = player().getAudioTrack();
        return track && typeof track.xtags === 'string' ? track.xtags : undefined;
    } catch (e) {
        return undefined;
    }
}

function openSession(request) {
    return fetch(`${SERVICE}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // TODO: follow the quality the viewer picked; the menu does not reach this yet.
        body: JSON.stringify(Object.assign({
            maxHeight: 2160,
            audioXtags: audioXtags(),
            fresh: changed.delete(request.videoId)
        }, request))
    })
        .then((response) => response.json())
        .then((answer) => {
            if (!answer.ok) throw new Error(answer.error);

            const video = answer.session.video;
            console.log(`[nativePlayback] ${answer.session.id}: itag ${video.itag} `
                + `${video.width}x${video.height}@${video.fps}, ${video.segments} segments`);

            return answer.session;
        });
}

// Read at each decision rather than once, so the setting takes effect on the next video
// instead of the next restart.
const wanted = () => configRead('bypassMediaSource');

if (typeof window !== 'undefined') {
    // Registered before the player has parsed anything. The response naming a video is what
    // starts a stream for it, and it arrives just before the player asks for a URL — which
    // is why the two can be joined without the page playing anything in between.
    onResponse('nativePlayback', ['streamingData'], (response) => {
        if (!wanted()) return;

        const request = sessionFrom(response);
        if (!playable(request) || opened.has(request.videoId)) return;

        // One at a time per video: the player asks again whenever it restarts, and a stream
        // left over from the previous attempt goes on downloading beside its replacement.
        const previous = opened.get(request.videoId);
        if (previous) closeSession(previous);

        // Marked before it is open, so a URL asked for in the meantime is still ours to
        // answer — the service holds that request until the stream behind it is ready.
        opened.set(request.videoId, null);
        attempts.delete(request.videoId);

        openSession(request).then(
            (session) => {
                if (!opened.has(request.videoId)) return closeSession(session.id);

                opened.set(request.videoId, session.id);
                serving = { videoId: request.videoId, video: session.video, audio: session.audio };
                watch();
                return null;
            },
            (failure) => {
                console.error(`[nativePlayback] ${request.videoId}: ${failure.message}`);

                // The URL already handed out will answer "no stream here". Forgetting the
                // video is what makes the player's next attempt an ordinary one.
                opened.delete(request.videoId);
            }
        );
    });

    // Installed once, before the player builds anything. Handing back a URL is the whole
    // intervention: the player attaches to a source that never feeds it, and the element
    // plays what the service is serving.
    replaceMediaSource(() => {
        if (!wanted()) return null;

        const videoId = attachingTo();
        if (!videoId || !opened.has(videoId)) return null;

        // Playing already means the player is re-attaching for its own reasons, not because
        // what it was given failed.
        const tried = playingOurs() ? 0 : (attempts.get(videoId) || 0) + 1;
        attempts.set(videoId, tried);

        if (tried > MOST_ATTEMPTS) {
            console.error(`[nativePlayback] ${videoId}: giving up after ${MOST_ATTEMPTS} attempts; playing the ordinary way`);

            // Stopped, not just unused. The player has the picture back and a download still
            // running at full speed is competing with it for the same network.
            const held = opened.get(videoId);
            opened.delete(videoId);
            if (serving && serving.videoId === videoId) serving = null;
            if (held) closeSession(held);

            return null;
        }

        // The player is committing to this one, so everything else being held for it is not
        // going to be watched.
        keepOnly(videoId);
        return manifestFor(videoId);
    });
}
