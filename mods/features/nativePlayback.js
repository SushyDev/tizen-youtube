import { configRead } from '../config.js';
import { note } from '../dev/journal.js';
import { onResponse } from '../youtube/json.js';
import { keepCurrentChoice } from './preferredVideoQuality.js';
import { replaceMediaSource } from '../youtube/mediaSource.js';
import { feed } from './mediaFeeder.js';

// Read when used rather than at import, because the tests load this file off the
// television where there is no page to have an origin.
const service = () => `${window.location.origin}/dash`;

const DESCRIPTIONS = {
    hls: 'master.m3u8',
    mp4: 'progressive.mp4',
    dash: 'manifest.mpd',

    mse: null
};

// Beyond this the set asks for the first chunk of a plain file and then consumes nothing,
// reporting no error: 553MB plays, 684MB does not. Duplicated from the service, which has
// the same number, because the page chooses a description before asking it anything.
const PLAIN_FILE_LIMIT = 600 * 1024 * 1024;

const plainFileBytes = new Map();

const weigh = (format, durationMs) => Number(format.contentLength)
    || Math.round(((format.bitrate || 0) / 8) * (durationMs / 1000));

function noteSize(request) {
    const ceiling = asked.get(request.videoId) || preferredHeight();
    const formats = request.formats || [];

    const video = formats
        .filter((one) => /^video\/mp4/.test(one.mimeType || '') && one.height
            && (!ceiling || one.height <= ceiling))
        .sort((a, b) => (b.height - a.height) || ((b.fps || 0) - (a.fps || 0)))[0];

    const audio = formats
        .filter((one) => /^audio\/mp4/.test(one.mimeType || ''))
        .sort((a, b) => weigh(b, request.durationMs) - weigh(a, request.durationMs))[0];

    plainFileBytes.set(request.videoId,
        (video ? weigh(video, request.durationMs) : 0) + (audio ? weigh(audio, request.durationMs) : 0));
}

function describedAs(videoId) {
    let chosen;
    try {
        chosen = configRead('nativePlaybackContainer');
    } catch (e) {
        return DESCRIPTIONS.dash;
    }

    // Named rather than looked up: its answer is `null`, which the fallback below would
    // quietly turn into a manifest.
    if (chosen === 'mse') return null;

    const wanted = DESCRIPTIONS[chosen] || DESCRIPTIONS.dash;
    if (wanted !== DESCRIPTIONS.mp4) return wanted;

    const bytes = plainFileBytes.get(videoId) || 0;
    return bytes > PLAIN_FILE_LIMIT ? DESCRIPTIONS.dash : wanted;
}

const manifestFor = (videoId) => `${service()}/by-video/${encodeURIComponent(videoId)}/${describedAs(videoId)}`;

const resumeAt = new Map();

export function startsAt(videoId, seconds) {
    if (seconds > 1) resumeAt.set(videoId, seconds);
    else resumeAt.delete(videoId);
}

function startsFrom(videoId) {
    const said = resumeAt.get(videoId) || 0;

    // Only while the element is still playing ours, which makes this a re-attach rather than
    // a load. On a load the clock still holds the *previous* video's position.
    let live = 0;
    if (playingOurs() && playerVideo() === videoId) {
        try {
            live = player().getCurrentTime() || 0;
        } catch (e) {}
    }

    const at = Math.max(said, live);
    return at > 1 ? at : 0;
}

function addressFor(videoId) {
    // One feeder per video: the player asks for a source more than once, and each ask would
    // otherwise start another appending the same segments into a different buffer.
    if (describedAs(videoId) === null) {
        const running = feeders.get(videoId);
        if (running) return running.address;

        const session = described.get(videoId);
        if (!session) return null;

        const started = feed(session, service().replace(/\/dash$/, ''));
        if (!started) return null;

        feeders.set(videoId, started);
        return started.address;
    }

    const address = manifestFor(videoId);
    const at = startsFrom(videoId);

    return at ? `${address}#t=${Math.floor(at)}` : address;
}

const AFTER_CHOOSING = 400;

const GIVE_UP_AFTER = 25000;

const described = new Map();

const feeders = new Map();

const opened = new Map();

const handedAt = new Map();

function clockStopsOnPlay(videoId) {
    const video = document.querySelector('video');
    if (!video) return;

    const playing = () => {
        if (handedAt.has(videoId) && !playingOurs()) return;

        video.removeEventListener('timeupdate', playing);
        if (!handedAt.delete(videoId)) return;

        note('element', `${videoId} is playing ours`);
        correctReportedRung();
    };

    video.addEventListener('timeupdate', playing);
    forgetWhenFinished(video);
}

const watchingForEnd = new WeakSet();

function forgetWhenFinished(video) {
    if (watchingForEnd.has(video)) return;
    watchingForEnd.add(video);

    video.addEventListener('ended', () => {
        const finished = playerVideo();
        if (!finished || !opened.has(finished)) return;

        note('stream', `${finished} finished; letting go so it can be played again`);

        const held = opened.get(finished);
        opened.delete(finished);
        handedAt.delete(finished);
        if (serving && serving.videoId === finished) serving = null;
        if (held) closeSession(held);
    });
}

const changed = new Set();

let serving = null;

const asked = new Map();

export function servingNow() {
    return serving;
}

function preferredHeight() {
    const preference = configRead('preferredVideoQuality');
    if (!preference || preference === 'highest') return 2160;

    const lines = parseInt(preference, 10);
    return lines > 0 ? lines : 2160;
}

function playerVideo() {
    try {
        const player = document.querySelector('#movie_player, .html5-video-player');
        const data = player && player.getVideoData && player.getVideoData();
        return (data && data.video_id) || null;
    } catch (e) {
        return null;
    }
}

function routeVideo() {
    const match = /[?&]v=([^&#]+)/.exec(window.location.hash || '');
    return match ? decodeURIComponent(match[1]) : null;
}

function attachingTo() {
    const fromPlayer = playerVideo();
    const fromRoute = routeVideo();

    if (fromPlayer && fromRoute && fromPlayer !== fromRoute) return null;
    return fromPlayer || fromRoute;
}

function closeSession(id) {
    return fetch(`${service()}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    }).catch(() => { });
}

const player = () => document.querySelector('#movie_player, .html5-video-player');

function playingOurs() {
    const video = document.querySelector('video');
    return Boolean(video && video.readyState >= 2 && String(video.currentSrc).indexOf('/dash/') !== -1);
}

export function chooseQuality(quality) {
    if (!serving || !playingOurs()) return;

    const height = heightOf(quality);
    if (!height || height === serving.video.height) return;

    asked.set(serving.videoId, height);
    changed.add(serving.videoId);

    keepCurrentChoice();

    const video = document.querySelector('video');
    const at = video ? video.currentTime : 0;

    note('choice', `quality ${quality} = ${height}p (serving ${serving.video.height}p)`);
    console.log(`[nativePlayback] the viewer chose ${quality} (${height}p)`);
    restart(serving.videoId, at);
}

function heightOf(quality) {
    try {
        const match = (player().getAvailableQualityData() || [])
            .filter((entry) => entry.quality === quality)[0];

        return match ? parseInt(match.qualityLabel, 10) || null : null;
    } catch (e) {
        return null;
    }
}

function restart(videoId, at) {
    try {
        player().loadVideoById(videoId, at);
    } catch (e) {
        console.error(`[nativePlayback] could not restart the video: ${e.message}`);
    }
}

export function chooseAudioTrack() {
    if (!serving || !playingOurs()) return;

    setTimeout(() => {
        if (!serving) return;

        const track = audioXtags();
        if (typeof track !== 'string' || track === (serving.audio.xtags || '')) return;

        changed.add(serving.videoId);

        const video = document.querySelector('video');
        note('choice', `audio ${JSON.stringify(track)} (serving ${JSON.stringify(serving.audio.xtags || '')})`);
        console.log(`[nativePlayback] the viewer chose the audio track ${JSON.stringify(track)}`);
        restart(serving.videoId, video ? video.currentTime : 0);
    }, AFTER_CHOOSING);
}

const RECONCILE_FOR = 6000;
const RECONCILE_EVERY = 250;

// A track it names that cannot be served would otherwise be asked for, missed, and asked
// for again for as long as the video plays.
const reconciled = new Set();

function reconcileAudio(videoId) {
    const deadline = Date.now() + RECONCILE_FOR;

    const look = () => {
        if (reconciled.has(videoId)) return;
        if (!serving || serving.videoId !== videoId) return;
        if (Date.now() > deadline) return;

        // Asked too early it answers for the video before this one.
        if (!playingOurs() || playerVideo() !== videoId) return void setTimeout(look, RECONCILE_EVERY);

        const track = audioXtags();
        if (typeof track !== 'string') return void setTimeout(look, RECONCILE_EVERY);

        reconciled.add(videoId);
        if (track === (serving.audio.xtags || '')) return;

        changed.add(videoId);

        const video = document.querySelector('video');
        note('audio', `the player wants ${JSON.stringify(track)}, serving `
            + `${JSON.stringify(serving.audio.xtags || '')}; opening again`);

        restart(videoId, video ? video.currentTime : 0);
    };

    setTimeout(look, RECONCILE_EVERY);
}

const correctedPlayer = new WeakSet();

function rungFor(height) {
    try {
        const ladder = player().getAvailableQualityData() || [];

        const match = ladder
            .filter((entry) => (parseInt(entry.qualityLabel, 10) || 0) >= height)
            .sort((a, b) => (parseInt(a.qualityLabel, 10) || 0) - (parseInt(b.qualityLabel, 10) || 0))[0];

        return match ? match.quality : null;
    } catch (e) {
        return null;
    }
}

function correctReportedRung() {
    const showing = player();
    if (!showing || correctedPlayer.has(showing)) return;

    const real = showing.getPlaybackQuality;
    if (typeof real !== 'function') return;

    correctedPlayer.add(showing);

    showing.getPlaybackQuality = function () {
        const said = real.apply(this, arguments);

        if (!serving || !serving.video || !playingOurs()) return said;

        return rungFor(serving.video.height) || said;
    };
}

export function fedByUs() {
    return feeders.size > 0;
}

function stopFeeding(videoId) {
    const running = feeders.get(videoId);
    if (!running) return;

    feeders.delete(videoId);
    try {
        running.stop();
    } catch (e) {}
}

function keepOnly(videoId) {
    opened.forEach((id, held) => {
        if (held === videoId) return;

        opened.delete(held);
        described.delete(held);
        stopFeeding(held);
        if (id) closeSession(id);
    });
}

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

function signedIn() {
    try {
        return window.ytcfg.data_.LOGGED_IN;
    } catch (e) {
        return undefined;
    }
}

function playable(request) {
    if (!request.videoId || !request.ustreamerConfig) return false;
    if (!request.formats.length) return false;

    // Live reports no length and has no fixed segment index.
    if (!(request.durationMs > 0)) return false;

    return request.formats.some((format) => /^video\/mp4/.test(format.mimeType || '')
        && format.height
        && format.type !== 'FORMAT_STREAM_TYPE_OTF');
}

function audioXtags() {
    try {
        const track = player().getAudioTrack();
        if (!track) return undefined;

        if (typeof track.xtags === 'string' && track.xtags) return track.xtags;

        const id = String(track.id || '');
        const tag = id.indexOf(';');

        // A video with one track says `und` and has nothing to distinguish.
        return tag === -1 ? undefined : id.slice(tag + 1);
    } catch (e) {
        return undefined;
    }
}

function tagText(xtags) {
    try {
        const base64 = String(xtags).replace(/-/g, '+').replace(/_/g, '/');
        return atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    } catch (e) {
        return '';
    }
}

// Keys are length-prefixed in the tag, so this matches the key itself rather than the
// same letters appearing in the language or the content type.
const ADJUSTED = /\x03drc|\x02vb/;

function defaultXtags(formats) {
    const defaults = (formats || []).filter((format) => format.audioTrack
        && format.audioTrack.audioIsDefault
        && typeof format.xtags === 'string');

    if (!defaults.length) return undefined;

    const plain = defaults.filter((format) => !ADJUSTED.test(tagText(format.xtags)));
    return (plain[0] || defaults[0]).xtags;
}

function wantedAudio(formats) {
    const said = audioXtags();
    return typeof said === 'string' ? said : defaultXtags(formats);
}

function openSession(request) {
    return fetch(`${service()}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({
            maxHeight: asked.get(request.videoId) || preferredHeight(),
            // Always, because whether the panel switches cannot be read beforehand:
            // `(video-dynamic-range: high)` reports the mode it is in, not what it can do, so
            // gating on it never asks and it never switches.
            hdr: true,
            audioXtags: wantedAudio(request.formats),

            // The element is told the same thing in a fragment, which a server never sees, so
            // without this the download starts at the beginning while the element asks for a
            // segment minutes in.
            startMs: Math.floor(startsFrom(request.videoId) * 1000),

            fresh: changed.delete(request.videoId)
        }, request))
    })
        .then((response) => response.json())
        .then((answer) => {
            if (!answer.ok) throw new Error(answer.error);

            const video = answer.session.video;
            const audio = answer.session.audio;

            note('stream', `open ${answer.session.id}: video itag ${video.itag} `
                + `${video.width}x${video.height}@${video.fps}, audio itag ${audio.itag} `
                + `xtags ${JSON.stringify(audio.xtags)}, ${video.segments} segments`);

            return answer.session;
        });
}

// The set's own decoder plays our stream silently at anything but normal speed, so this
// decides which pipeline the video can use and is needed before the element has a rate.
let intendedRate = 1;

let lastVideo = null;

const startingRate = () => (configRead('rememberPlaybackSpeed')
    ? Number(configRead('videoSpeed')) || 1
    : 1);

export function noteSpeed(value) {
    const now = Number(value) > 0 ? Number(value) : 1;
    if (now === intendedRate) return;

    const was = intendedRate;
    intendedRate = now;

    if ((was === 1) === (now === 1)) return;
    if (!configRead('bypassMediaSource')) return;

    const videoId = attachingTo();
    if (!videoId) return;

    const video = document.querySelector('video');
    const at = video ? video.currentTime : 0;

    note('speed', `${was}x to ${now}x: ${now === 1 ? 'taking the picture back' : 'handing it to the page'}`);

    if (now !== 1) {
        const held = opened.get(videoId);
        opened.delete(videoId);
        handedAt.delete(videoId);
        if (serving && serving.videoId === videoId) serving = null;
        if (held) closeSession(held);
    }

    // The player starts every load at normal speed, so without this the choice that caused
    // the load would be lost by the load.
    if (video) {
        const apply = () => {
            video.removeEventListener('canplay', apply);
            video.playbackRate = now;
        };
        video.addEventListener('canplay', apply);
    }

    restart(videoId, at);
}

const wanted = () => configRead('bypassMediaSource') && intendedRate === 1;

if (typeof window !== 'undefined') {
    onResponse('nativePlayback', ['streamingData'], (response) => {
        const request = sessionFrom(response);
        if (!playable(request)) {
            if (request.videoId && request.formats.length) {
                note('player', `nothing to serve for ${request.videoId}: `
                    + `${request.formats.length} formats, none of them an indexed MP4 picture`
                    + ` (signed in: ${signedIn()})`);
            }
            return;
        }

        if (request.videoId !== lastVideo) {
            lastVideo = request.videoId;
            intendedRate = startingRate();
        }

        if (!wanted()) return;

        // The same response can arrive twice, so one already being served is nothing to act on —
        // unless the viewer changed something, when this is the reload they asked for.
        if (opened.has(request.videoId) && !changed.has(request.videoId)) return;

        if (!changed.has(request.videoId)) {
            asked.delete(request.videoId);
            reconciled.delete(request.videoId);
        }

        // One at a time per video, or a stream left from the previous attempt goes on downloading
        // beside its replacement.
        const previous = opened.get(request.videoId);
        if (previous) closeSession(previous);

        // Marked before it is open, so a URL asked for meanwhile is still ours to answer.
        opened.set(request.videoId, null);
        handedAt.delete(request.videoId);

        noteSize(request);

        note('player', `response for ${request.videoId}: ${request.formats.length} formats, `
            + `${Math.round(request.durationMs / 1000)}s, asked ${asked.get(request.videoId) || 'none'}, `
            + `player track ${JSON.stringify(audioXtags())}, `
            + `default ${JSON.stringify(defaultXtags(request.formats))}`);

        openSession(request).then(
            (session) => {
                if (!opened.has(request.videoId)) return closeSession(session.id);

                opened.set(request.videoId, session.id);
                described.set(request.videoId, session);
                serving = { videoId: request.videoId, video: session.video, audio: session.audio };
                reconcileAudio(request.videoId);
                return null;
            },
            (failure) => {
                note('stream', `open failed for ${request.videoId}: ${failure.message}`);
                console.error(`[nativePlayback] ${request.videoId}: ${failure.message}`);

                opened.delete(request.videoId);
            }
        );
    });

    window.addEventListener('hashchange', () => {
        const videoId = routeVideo();
        if (videoId === serving?.videoId) return;

        note('stream', `left ${serving ? serving.videoId : 'the video'}; closing what it was fetching`);
        keepOnly(videoId);
        if (!videoId) serving = null;
    });

    replaceMediaSource(() => {
        if (!wanted()) return null;

        const videoId = attachingTo();
        if (!videoId || !opened.has(videoId)) return null;

        if (playingOurs()) {
            handedAt.delete(videoId);
        } else if (!handedAt.has(videoId)) {
            handedAt.set(videoId, Date.now());
            clockStopsOnPlay(videoId);
        }

        const waiting = handedAt.has(videoId) ? Date.now() - handedAt.get(videoId) : 0;

        if (waiting > GIVE_UP_AFTER) {
            note('stream', `gave up on ${videoId} after ${Math.round(waiting / 1000)}s; the page plays it`);
            console.error(`[nativePlayback] ${videoId}: nothing played in ${Math.round(waiting / 1000)}s; playing the ordinary way`);

            const held = opened.get(videoId);
            opened.delete(videoId);
            handedAt.delete(videoId);
            if (serving && serving.videoId === videoId) serving = null;
            if (held) closeSession(held);

            return null;
        }

        keepOnly(videoId);

        const address = addressFor(videoId);
        note('element', `handed ${videoId} ${address.slice(address.indexOf('/dash/'))}`);

        return address;
    });
}
