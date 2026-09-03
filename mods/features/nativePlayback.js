import { configRead } from '../config.js';
import { note } from '../dev/journal.js';
import { onResponse } from '../youtube/json.js';
import { keepCurrentChoice } from './preferredVideoQuality.js';
import { replaceMediaSource } from '../youtube/mediaSource.js';

// Points the player at a stream the service serves rather than at its own MediaSource.
// Same decoder, same element, same media: through MediaSource this hardware drops frames at
// 2160p60 and from a URL it drops none. The player keeps its interface and keeps driving
// playback; it is just not the thing feeding the decoder.

// Read when it is used rather than when this is imported: the file is loaded off the
// television by the tests, where there is no page to have an origin.
const service = () => `${window.location.origin}/dash`;

// Where the player is pointed, from the first moment it asks. The stream behind it is still
// opening then, so the service holds the request — a short wait reads as loading, where
// playing something else first and swapping reads as a black screen and a spinner.
// Which description to hand over. Read at each hand-out rather than once, so changing it
// takes effect on the next video instead of the next launch.
const DESCRIPTIONS = {
    hls: 'master.m3u8',
    mp4: 'progressive.mp4',
    dash: 'manifest.mpd'
};

// Beyond this the set will not play a plain file at all — it asks for the first chunk and
// then consumes nothing, with no error to notice. Measured by bisection on the television:
// 553MB plays, 684MB does not. So a video too large for one is described as a manifest
// instead, which has no such limit, and the viewer gets a picture rather than a black
// screen. The number is the service's; this is the same one, because the choice of address
// has to be made before the service is asked anything.
const PLAIN_FILE_LIMIT = 600 * 1024 * 1024;

// Roughly how large each video would be as one plain file, worked out from the response
// that named its formats — which the page holds well before the player asks for an address,
// where the size the service could report arrives too late to decide anything.
const plainFileBytes = new Map();

/** What one format weighs, said outright where the response says it and estimated where not. */
const weigh = (format, durationMs) => Number(format.contentLength)
    || Math.round(((format.bitrate || 0) / 8) * (durationMs / 1000));

function noteSize(request) {
    const ceiling = asked.get(request.videoId) || preferredHeight();
    const formats = request.formats || [];

    // The same order the service picks in, near enough for a limit measured in hundreds of
    // megabytes: the tallest mp4 picture within the ceiling, and the heaviest mp4 sound.
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
    let wanted;
    try {
        wanted = DESCRIPTIONS[configRead('nativePlaybackContainer')] || DESCRIPTIONS.dash;
    } catch (e) {
        return DESCRIPTIONS.dash;
    }

    if (wanted !== DESCRIPTIONS.mp4) return wanted;

    const bytes = plainFileBytes.get(videoId) || 0;
    return bytes > PLAIN_FILE_LIMIT ? DESCRIPTIONS.dash : wanted;
}

const manifestFor = (videoId) => `${service()}/by-video/${encodeURIComponent(videoId)}/${describedAs(videoId)}`;

// Where the player means to begin, by video: a part-watched one resumes where it was left.
const resumeAt = new Map();

/** Told by the page when a video is opened at a position rather than at its start. */
export function startsAt(videoId, seconds) {
    if (seconds > 1) resumeAt.set(videoId, seconds);
    else resumeAt.delete(videoId);
}

/**
 * The address, with the moment the player means to start at.
 *
 * Without it the element is handed a manifest describing the whole video and does the
 * obvious thing: begins at the beginning. The viewer sees the opening seconds play before
 * the seek lands. MediaSource never showed that, because the player only ever gave it the
 * segments around the position it wanted.
 */
function startsFrom(videoId) {
    let at = resumeAt.get(videoId) || 0;
    try {
        at = Math.max(at, player().getCurrentTime() || 0);
    } catch (e) {
        // The player has not got that far; whatever the page said stands.
    }

    return at > 1 ? at : 0;
}

function addressFor(videoId) {
    const address = manifestFor(videoId);
    const at = startsFrom(videoId);

    return at ? `${address}#t=${Math.floor(at)}` : address;
}

// How long to let the player apply a change before reading back what it settled on. The
// menu says a track by the name it shows; the player says which format that is.
const AFTER_CHOOSING = 400;

// How long a video may be handed our address without the picture ever coming from it.
// A player that cannot play what it is given asks again, and again, so without a limit the
// page spends its life attaching to a stream that will never work rather than falling back
// to the one that always does.
//
// Measured in time rather than in attempts: the player re-attaches in bursts, and counting
// those gives up seconds into a stream that was only slow to start.
const GIVE_UP_AFTER = 25000;

// Streams the service is holding for us, by video. The page asks about more than one — it
// loads responses for what it might play next — and which one the player is actually
// setting up for is only known when it asks for a URL.
const opened = new Map();

// When each was handed over with nothing playing yet, so one that never plays is given up
// on. Cleared the moment the picture arrives, by the element itself: between one hand-out
// and the next the player says nothing, and a video watched for a minute would otherwise
// carry a minute-old clock into the next thing that made the player re-attach.
const handedAt = new Map();

/**
 * Stops the clock on a video as soon as the stream is actually playing.
 *
 * The listener takes itself off on the first frame, or once the clock has stopped for any
 * other reason, so at most one is ever attached.
 */
function clockStopsOnPlay(videoId) {
    const video = document.querySelector('video');
    if (!video) return;

    const playing = () => {
        if (handedAt.has(videoId) && !playingOurs()) return;

        video.removeEventListener('timeupdate', playing);
        if (!handedAt.delete(videoId)) return;

        note('element', `${videoId} is playing ours`);
    };

    video.addEventListener('timeupdate', playing);
    forgetWhenFinished(video);
}

// Elements already being watched for the end of a video, so the listener goes on once each.
const watchingForEnd = new WeakSet();

/**
 * Lets go of a video once it has finished, so playing it again opens it again.
 *
 * A video is only opened when the response naming it arrives for one this app is not
 * already holding — the page loads responses for what it might play next, and the same one
 * arrives more than once, so acting on every one of them would reopen a stream mid-play.
 * But a video that has run to its end is still held, so playing it a second time was
 * ignored: no session was opened, the element was never handed an address, and the page
 * played it through MediaSource. Which is what "repeat does not work" looks like, and what
 * a viewer would then see is the frame drops this app exists to avoid.
 */
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

// Set when a change is what caused the video to be loaded again, so the service knows to
// wait for the player to say what was chosen rather than reading the previous answer.
const changed = new Set();

// What is being served for the video now playing, so a change can be seen.
let serving = null;

// The picture the viewer asked for during this video, if they asked. Only ever set from a
// choice made in the menu, and forgotten when the video is opened afresh: a rung picked
// once is not a preference for everything after it.
const asked = new Map();

/**
 * The formats the element is really being fed, or nothing when it is on its own player.
 *
 * The player's own stats say what the player selected, which is not what is playing once
 * the picture comes from here — it will report opus while the set decodes AAC.
 */
export function servingNow() {
    return serving;
}

/** The ceiling to open at when the viewer has not said otherwise. */
function preferredHeight() {
    const preference = configRead('preferredVideoQuality');
    if (!preference || preference === 'highest') return 2160;

    const lines = parseInt(preference, 10);
    return lines > 0 ? lines : 2160;
}

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
    return fetch(`${service()}/close`, {
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
 * The viewer picked a quality from the player's own menu.
 *
 * This is the only reliable sign of it. The quality the player reports is whatever its
 * adaptive logic settled on, and with a source that never reports a network it settles
 * somewhere and stays; the menu, on the other hand, says what was asked for.
 */
export function chooseQuality(quality) {
    if (!serving || !playingOurs()) return;

    const height = heightOf(quality);
    if (!height || height === serving.video.height) return;

    asked.set(serving.videoId, height);
    changed.add(serving.videoId);

    // The restart below looks like a new video to the preference, which would apply itself
    // over the choice that caused it.
    keepCurrentChoice();

    const video = document.querySelector('video');
    const at = video ? video.currentTime : 0;

    note('choice', `quality ${quality} = ${height}p (serving ${serving.video.height}p)`);
    console.log(`[nativePlayback] the viewer chose ${quality} (${height}p)`);
    restart(serving.videoId, at);
}

/** What a quality is called in lines, from the list the player itself offers. */
function heightOf(quality) {
    try {
        const match = (player().getAvailableQualityData() || [])
            .filter((entry) => entry.quality === quality)[0];

        return match ? parseInt(match.qualityLabel, 10) || null : null;
    } catch (e) {
        return null;
    }
}

/**
 * Starts the video again through the player's own API, at the moment it had reached.
 *
 * Nothing here touches the element. It is the player's, and reaching past it to change what
 * it is playing is what leaves its controls out of step with the picture.
 */
function restart(videoId, at) {
    try {
        player().loadVideoById(videoId, at);
    } catch (e) {
        console.error(`[nativePlayback] could not restart the video: ${e.message}`);
    }
}

/**
 * The viewer picked an audio track from the player's own menu.
 *
 * The menu names it as it is shown — "French (FR)" — and what has to be fetched is a
 * format. So the player is left to apply the choice and then asked what it is playing,
 * which answers in the only terms that identify a format exactly.
 */
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

// How long to keep asking the player what it is playing, and how often. It answers within
// a moment of building itself; a video where it never does is one where the response's own
// default is the best anyone knows.
const RECONCILE_FOR = 6000;
const RECONCILE_EVERY = 250;

// Videos already checked against the player's answer. A track it names that cannot be
// served would otherwise be asked for, missed, and asked for again for as long as it plays.
const reconciled = new Set();

/**
 * Puts the sound right once the player can say what it means to play.
 *
 * The stream is opened from the response, which knows the video's default track but not the
 * viewer's standing preference for a dub, nor whether stable volume or voice boost is on.
 * The player knows all three, a moment later. Once per video: the restart is the same one a
 * menu choice causes, and one of those near the start is a flicker where a stream of them
 * would be unwatchable.
 */
function reconcileAudio(videoId) {
    const deadline = Date.now() + RECONCILE_FOR;

    const look = () => {
        if (reconciled.has(videoId)) return;
        if (!serving || serving.videoId !== videoId) return;
        if (Date.now() > deadline) return;

        // Asked too early it answers for the video before this one, so the player has to
        // agree it is on this one and to have our stream on the element.
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

/** Everything but this one is media nobody is watching, still being fetched. */
/**
 * Closes what the viewer has moved on from.
 *
 * Every one of these is a stream running at the full rate of a 2160p60 encode, so leaving
 * one behind is not merely untidy: measured on the set, a download for a video already left
 * ran fifteen seconds into the next one and finished sixty-two megabytes later, and the
 * video actually on screen juddered and dropped the whole time it was sharing the line.
 *
 * Sparing the one the element still points at was tried, because closing it used to leave
 * the player holding an address nobody served — black picture behind its own controls,
 * never asking again. That is fixed where it belongs: the service now refuses at once for
 * a track it has stopped fetching, rather than making the element wait out the segment
 * timeout, so the player learns the source is finished and attaches again.
 */
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

/**
 * Whether anyone is signed in, when the page will say.
 *
 * Recorded beside a response that cannot be served, not because it is known to be the
 * cause — the enhanced player has worked with this reading false — but because it is one
 * of the few things about the client that can be read at that moment and compared later.
 */
function signedIn() {
    try {
        return window.ytcfg.data_.LOGGED_IN;
    } catch (e) {
        return undefined;
    }
}

/**
 * Whether this is a response the picture can be taken over for.
 *
 * YouTube sometimes offers a video only as transcoded-on-the-fly formats, which carry no
 * segment index — and the index is what the whole manifest is written from. Recognising
 * that here rather than finding out from the bytes is the difference between the page
 * playing the video and the viewer watching nothing for as long as the service waits.
 */
function playable(request) {
    if (!request.videoId || !request.ustreamerConfig) return false;
    if (!request.formats.length) return false;

    // Live reports no length and has no fixed segment index, so there is nothing to
    // describe and nothing to serve.
    if (!(request.durationMs > 0)) return false;

    return request.formats.some((format) => /^video\/mp4/.test(format.mimeType || '')
        && format.height
        && format.type !== 'FORMAT_STREAM_TYPE_OTF');
}

/**
 * The audio track the player is playing, as the tag that identifies which format it is.
 *
 * Not from the track's own `xtags`, which is empty on every one of them. What tells a
 * dubbed track from the original is its id — `itag;xtags` — and the itag there names the
 * track's WebM form while the tag itself is the same one the MP4 formats carry.
 */
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

/** The bytes of an xtags tag, whose keys are plain text inside it. */
function tagText(xtags) {
    try {
        const base64 = String(xtags).replace(/-/g, '+').replace(/_/g, '/');
        return atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    } catch (e) {
        return '';
    }
}

// A tag holds its keys length-prefixed, so this matches the key itself rather than the two
// letters appearing anywhere in the language or the content type.
const ADJUSTED = /\x03drc|\x02vb/;

/**
 * The tag of the track YouTube marks as this video's own default, read from the response.
 *
 * The player cannot be asked yet. Its response arrives before it has built anything, so
 * `getAudioTrack()` answers nothing, and without this the choice falls through to the
 * highest bitrate — which on a video with dubs is a dub, in whichever language happens to
 * be encoded fattest.
 *
 * Several formats carry the default mark, differing only in whether the dynamic range is
 * compressed or the voice lifted. Those are the viewer's settings rather than the video's,
 * and nothing has said yet whether they are on, so the untouched one is taken and anything
 * else is put right once the player answers for itself.
 */
function defaultXtags(formats) {
    const defaults = (formats || []).filter((format) => format.audioTrack
        && format.audioTrack.audioIsDefault
        && typeof format.xtags === 'string');

    if (!defaults.length) return undefined;

    const plain = defaults.filter((format) => !ADJUSTED.test(tagText(format.xtags)));
    return (plain[0] || defaults[0]).xtags;
}

/** Which sound to fetch: what the player says, or failing that what the video says. */
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
            // Always asked for where the video has it. Whether the panel switches cannot be
            // read beforehand: `(video-dynamic-range: high)` reports the output mode it is
            // in at that moment, not what it can do — and it is only in standard because
            // nothing has asked it to change. Gating on it never asks, so it never switches.
            hdr: true,
            audioXtags: wantedAudio(request.formats),

            // Where the picture is wanted from, said to the service as well as to the
            // element. The element is told in a fragment, which a server never sees — so
            // without this the download starts at the beginning of the video while the
            // element asks for a segment three minutes in. Serving that means abandoning
            // the download and starting another one there, and at 2160p60 a segment is
            // eighteen megabytes: measured at ten seconds from the ask to the bytes,
            // which is longer than this television's player will wait. It gave up, and a
            // part-watched video fell back to the default player every time.
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

// What the video is meant to run at, which is not what the element says during a reload:
// the player resets the rate to normal while it loads and the choice is put back after.
//
// The set's own decoder plays our stream silently at anything but normal speed — through
// MediaSource it does not — so this decides which pipeline the video can use, and it has
// to be known before the element has a rate to read.
let intendedRate = 1;

// The video the last response was for, so a genuinely different one can be told from this
// one being loaded again. Only the former starts at the speed YouTube would start it at.
let lastVideo = null;

/** The speed a video begins at: normal, unless the viewer asked for the last one to carry. */
const startingRate = () => (configRead('rememberPlaybackSpeed')
    ? Number(configRead('videoSpeed')) || 1
    : 1);

/**
 * The viewer changed the speed.
 *
 * Only crossing normal speed matters — 1.5 to 2 stays where it is — and crossing it means
 * the video has to be loaded again, because which pipeline is feeding the decoder is
 * settled when the player builds its source and cannot be changed under it.
 */
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

    // Leaving ours: the download is no longer feeding anything, and left running it
    // competes with the player for the same network.
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

// Read at each decision rather than once, so the setting takes effect on the next video
// instead of the next restart.
const wanted = () => configRead('bypassMediaSource') && intendedRate === 1;

if (typeof window !== 'undefined') {
    // Registered before the player has parsed anything. The response naming a video is what
    // starts a stream for it, and it arrives just before the player asks for a URL — which
    // is why the two can be joined without the page playing anything in between.
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

        // Before `wanted` is consulted: a video the viewer has not reached yet cannot be
        // ruled out by the speed they left the last one at.
        if (request.videoId !== lastVideo) {
            lastVideo = request.videoId;
            intendedRate = startingRate();
        }

        if (!wanted()) return;

        // The page loads responses for what it might play next, and the same one can arrive
        // twice, so a video already being served is normally nothing to act on. Unless the
        // viewer changed something: then this response is the reload that change asked for,
        // and ignoring it leaves them watching the stream they just changed away from.
        if (opened.has(request.videoId) && !changed.has(request.videoId)) return;

        // Opened afresh rather than reopened for a change the viewer made: whatever rung
        // they picked last time belongs to that watching, not to this one.
        if (!changed.has(request.videoId)) {
            asked.delete(request.videoId);
            reconciled.delete(request.videoId);
        }

        // One at a time per video: the player asks again whenever it restarts, and a stream
        // left over from the previous attempt goes on downloading beside its replacement.
        const previous = opened.get(request.videoId);
        if (previous) closeSession(previous);

        // Marked before it is open, so a URL asked for in the meantime is still ours to
        // answer — the service holds that request until the stream behind it is ready.
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
                serving = { videoId: request.videoId, video: session.video, audio: session.audio };
                reconcileAudio(request.videoId);
                return null;
            },
            (failure) => {
                note('stream', `open failed for ${request.videoId}: ${failure.message}`);
                console.error(`[nativePlayback] ${request.videoId}: ${failure.message}`);

                // The URL already handed out will answer "no stream here". Forgetting the
                // video is what makes the player's next attempt an ordinary one.
                opened.delete(request.videoId);
            }
        );
    });

    // Leaving a video should stop fetching it. Without this the service goes on pulling
    // media for something nobody is watching until it times out, and everything else on
    // the connection — the next video, the thumbnails — waits behind it.
    window.addEventListener('hashchange', () => {
        const videoId = routeVideo();
        if (videoId === serving?.videoId) return;

        note('stream', `left ${serving ? serving.videoId : 'the video'}; closing what it was fetching`);
        keepOnly(videoId);
        if (!videoId) serving = null;
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

            // Stopped, not just unused. The player has the picture back and a download still
            // running at full speed is competing with it for the same network.
            const held = opened.get(videoId);
            opened.delete(videoId);
            handedAt.delete(videoId);
            if (serving && serving.videoId === videoId) serving = null;
            if (held) closeSession(held);

            return null;
        }

        // The player is committing to this one, so everything else being held for it is not
        // going to be watched.
        keepOnly(videoId);

        const address = addressFor(videoId);
        note('element', `handed ${videoId} ${address.slice(address.indexOf('/dash/'))}`);

        return address;
    });
}
