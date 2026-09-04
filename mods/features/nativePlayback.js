import { configRead } from '../config.js';
import { note } from '../dev/journal.js';
import { onResponse } from '../youtube/json.js';
import { findPlayerApi } from '../youtube/internals.js';
import { keepCurrentChoice } from './preferredVideoQuality.js';
import { replaceMediaSource } from '../youtube/mediaSource.js';
import { feed } from './mediaFeeder.js';

// Read when used rather than at import, because the tests load this file off the
// television where there is no page to have an origin.
const service = () => `${window.location.origin}/dash`;

const DESCRIPTIONS = {
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

    if (!at) return address;

    // Both, and they do different jobs. `#t=` is a media fragment: the browser strips it
    // before the request and uses it to seek once the presentation is loaded, so the server
    // never learns of it and the stream opens at the beginning — which is why a resumed or
    // sought-to position used to cost a load from zero and then a jump. `?at=` is a query,
    // so it survives to the service, which positions the stream before answering.
    return `${address}?at=${Math.floor(at)}#t=${Math.floor(at)}`;
}

const AFTER_CHOOSING = 400;



const GIVE_UP_AFTER = 25000;

const described = new Map();

const feeders = new Map();

const opened = new Map();

const handedAt = new Map();

// Which open is the current one, per video. A session that finishes opening after another
// has started for the same video has nobody left to close it.
const attempts = new Map();

function clockStopsOnPlay(videoId) {
    const video = document.querySelector('video');
    if (!video) return;

    // At handover, not on the first timeupdate: between the two the menu answers out of
    // the player's own pipeline, and it was caught saying 1440p over a 2160p picture and
    // then correcting itself a moment later. Idempotent, so calling it early costs
    // nothing — the reading is only altered while this app is feeding the element.
    correctReportedRung();

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

// The set's pipeline does not always flush for a seek. It keeps the buffer it had, reports
// `readyState 4` for a playhead far outside it, and discards every fragment served at the new
// position — complete, correctly framed, correctly timed, and refused, because as far as it
// is concerned nothing is missing.
//
// This follows how YouTube's own TV player handles the same hardware, which is worth copying
// rather than inventing, because it has to survive every set that we do.
//
// Two things it does that matter here. The first is that the watchdog is a timer, not an
// event listener: a wedged element stops firing events, so anything hung off `seeking` or
// `waiting` goes quiet exactly when it is needed. Theirs re-arms itself every second and
// infers the wedge from state that has failed to change. The second is that the fix is a
// ladder, cheapest first, and each rung is given a moment to work before the next is tried —
// re-issue the seek, then nudge it by a millisecond, and only then throw the presentation
// away. Reloading is their last resort. It was our first, which is why a two second jump
// cost a full reload and hid whatever was really wrong.
//
// The nudge is the part that looks like superstition and is not: they apply it only when the
// target is already inside `buffered` — data present, pipeline stuck, which is our case
// exactly — and a millisecond is enough to make the pipeline re-evaluate a seek it has
// decided it has already satisfied.
const WATCHES_EVERY = 1000;

// Ticks of no progress before each rung. A seek that is merely slow settles well inside the
// first: the slowest honest fragment measured here was 1.7s.
// Late, because a seek is allowed to take a moment and this is a last resort rather than a
// step in the process. These were tightened to two seconds to beat a renderer block on WebM,
// which no longer happens now the manifest describes that file by its own cues. Two seconds
// is below the honest cost of an AV1 seek — a segment is fifteen megabytes and takes about
// two seconds to fetch before a frame can be shown — so the ladder was firing on healthy
// seeks, reporting them as freezes, and interfering with ones that were about to finish on
// their own.
const RE_SEEK_AFTER = 6;
const NUDGE_AFTER = 8;
const CYCLE_AFTER = 10;

const NUDGE = 0.001;


let watching = null;

function watchSeeks() {
    document.addEventListener('seeking', (event) => {
        const video = event.target;
        if (!video || video.tagName !== 'VIDEO') return;
        if (String(video.currentSrc || video.src || '').indexOf('/dash/') === -1) return;

        // Only for a seek out of playback that was actually running. A video still opening
        // has a playhead that does not move either, and arming for that tore down a video in
        // the middle of starting — on WebM, where the first rung is to replace the element.
        //
        // `played` and not `readyState`: readyState drops below HAVE_FUTURE_DATA during a
        // seek, which is precisely when this fires, so asking it here disqualified every
        // real seek as well. What has been played cannot be un-played by seeking away from
        // it, so an element with an empty `played` has never shown a frame and is opening.
        if (!video.played || video.played.length === 0) return;

        const at = video.currentTime;

        // Every rung of the ladder below seeks, and seeking fires this. A watch already
        // running for what is essentially this position therefore keeps its place: without
        // that, asking again resets the counter that was about to try nudging, and the
        // cheapest rung repeats for ever while the viewer waits — measured, six times in a
        // row at three second intervals, never reaching the rung that would have worked.
        if (watching && watching.video === video && Math.abs(watching.at - at) < 1) return;

        // Only the target is taken here. Whether the seek worked is decided by the timer,
        // because this event is the last one a wedged element sends.
        watching = { video, at, still: 0, rung: 0, seeked: 0 };
    }, true);

    // `seeked` is how the reference player decides a seek is done, so whether it arrives at
    // all is the difference between a platform that refused the seek and one that performed
    // it onto media it then would not decode.
    document.addEventListener('seeked', (event) => {
        if (watching && watching.video === event.target) watching.seeked += 1;
    }, true);

    setInterval(() => {
        if (!watching) return;

        const { video, at } = watching;

        if (!video.isConnected || video.paused || video.ended) return stopWatching();
        if (String(video.currentSrc || video.src || '').indexOf('/dash/') === -1) return stopWatching();

        // Moved on, so the seek took.
        if (video.currentTime > at + 0.25) {
            if (watching.rung) note('element', `seek to ${Math.floor(at)}s came back after ${watching.rung} nudge(s)`);
            return stopWatching();
        }

        watching.still += 1;
        climb();
    }, WATCHES_EVERY);
}

function stopWatching() {
    watching = null;
}

function holdsAlready(video, at) {
    for (let i = 0; i < video.buffered.length; i++) {
        if (at >= video.buffered.start(i) - 0.5 && at <= video.buffered.end(i)) return true;
    }

    return false;
}

function climb() {
    const { video, at, still, rung } = watching;

    // On WebM every cheap rung is skipped and the element is replaced instead, because each
    // of them writes `currentTime` and writing `currentTime` to a wedged decoder there does
    // not merely fail — it blocks the renderer. Measured: the ladder logs its first rung and
    // the page never ticks again, whichever rung happens to be first. That is why the
    // replacement was unreachable for so long; it sat behind the step that killed the page.
    // Replacing the element touches nothing on the old one but its removal.
    //
    // Declared before anything reads it. It was written below its first use, which is a
    // `const` in its dead zone: every tick threw, no rung ever ran, and a ladder that was
    // doing nothing at all looked like a ladder whose rungs were being skipped on purpose.
    //
    // On MP4 the pause/play rung is the one that works — the decoder comes back and the
    // stream, the presentation and the element are all left alone. On WebM it is the last
    // thing that runs before the page stops running at all, so there it is skipped and the
    // replacement is tried in its place.
    const mp4 = !serving || !serving.video || serving.video.container !== 'webm';

    // Between the nudge and the replacement, the cheapest thing that makes a decoder look
    // again.
    // The set completes the seek — `seeked` fires, `seeking` clears, `readyState` is 4, no
    // error — and then holds the picture it already had. Nothing is missing as far as it is
    // concerned, so nothing that asks it for more will help; what is needed is for playback
    // itself to stop and start, which is the one lever left that does not throw the
    // presentation away.
    if (mp4 && still >= CYCLE_AFTER && rung < 3) {
        watching.rung = 3;
        note('element', `seek to ${Math.floor(at)}s completed and froze; stopping and starting playback`);

        try {
            video.pause();
            const started = video.play();
            if (started && started.catch) started.catch(() => {});
        } catch (e) {}

        return undefined;
    }

    if (still >= NUDGE_AFTER && rung < 2 && holdsAlready(video, at)) {
        watching.rung = 2;
        note('element', `seek to ${Math.floor(at)}s holds its target and will not take it`
            + ` (seeked ${watching.seeked}, paused ${video.paused}); nudging`);
        try { video.currentTime = at + NUDGE; } catch (e) {}
        return undefined;
    }

    if (still >= RE_SEEK_AFTER && rung < 1) {
        watching.rung = 1;

        // Which of the two failures this is, which decides everything after it. `seeking`
        // still true means the platform never finished the seek and is waiting for something
        // it will not get; false with a playhead that has not moved means it finished and the
        // decoder is holding a picture it will not replace. They look identical from the sofa
        // and want opposite fixes.
        note('element', `seek to ${Math.floor(at)}s has not moved after ${still}s`
            + ` (seeking ${video.seeking}, readyState ${video.readyState},`
            + ` networkState ${video.networkState}, seeked ${watching.seeked}); asking again`);

        try { video.currentTime = at; } catch (e) {}
    }

    return undefined;
}

export function chooseQuality(quality) {
    // Three ways this used to do nothing at all, none of which said so — a pick that never
    // arrives and a pick that is dropped here look the same from the sofa.
    if (!serving || !playingOurs()) {
        return note('choice', `${quality} ignored: ${serving ? 'not playing ours' : 'nothing being served'}`);
    }

    const height = heightOf(quality);

    if (!height) return note('choice', `${quality} ignored: no height known for it`);

    if (height === serving.video.height) {
        return note('choice', `${quality} ignored: already serving ${height}p`);
    }

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

// The element and the app's own player are two different objects, and only one of them
// answers this. Asking the element alone left a quality change accepted, logged, and then
// silently doing nothing at all — the journal stopped after `choice` and the picture went
// with it, because the failure only ever reached a console nobody can read on a set.
function restart(videoId, at) {
    const targets = [findPlayerApi(), player()];

    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        if (!target || typeof target.loadVideoById !== 'function') continue;

        try {
            target.loadVideoById(videoId, at);
            return;
        } catch (e) {
            note('choice', `restart refused by ${i ? 'the element' : 'the player'}: ${e.message}`);
        }
    }

    note('choice', `could not restart ${videoId}: nothing took loadVideoById`);
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

// The readings as they were before this app altered them. Correcting what the player
// reports makes the page player's own choice unreadable through the same methods — which
// cost a measurement today: a test of whether its quality could be pinned read back this
// app's corrected answer and looked like a success. Diagnostics ask here instead.
const untouched = new WeakMap();

// The whole ladder entry, because the menu shows a tick and a label and they come from
// two different methods. Correcting one and not the other is how it came to say 1080p60
// over a 3840x2160 picture.
function rungFor(height) {
    try {
        const ladder = player().getAvailableQualityData() || [];

        return ladder
            .filter((entry) => (parseInt(entry.qualityLabel, 10) || 0) >= height)
            .sort((a, b) => (parseInt(a.qualityLabel, 10) || 0) - (parseInt(b.qualityLabel, 10) || 0))[0] || null;
    } catch (e) {
        return null;
    }
}

// Only the rungs YouTube names; anything else falls back to what the player said.
const RUNG_NAMES = {
    2160: 'hd2160', 1440: 'hd1440', 1080: 'hd1080', 720: 'hd720',
    480: 'large', 360: 'medium', 240: 'small', 144: 'tiny'
};

// What the element is actually decoding, which is what the viewer is actually watching and
// what the nerd stats show. The rung this app asked to serve is the fallback, for the
// moment before the first frame gives the element its dimensions — everything reported
// while the enhanced player is feeding comes from the picture itself, so the menu cannot
// drift away from it the way the player's own adaptive state does.
function showingHeight() {
    const video = document.querySelector('video');
    if (video && video.videoHeight) return video.videoHeight;

    return (serving && serving.video && serving.video.height) || 0;
}

function synthesise(name, height) {
    if (!height) return null;
    return name === 'getPlaybackQualityLabel' ? `${height}p` : (RUNG_NAMES[height] || null);
}

// Both of them. The element is what this app's own readings go through; the registry's
// player API is what the app's own menus ask, and correcting only the element is why the
// quality menu went on reporting the page player's decaying guess — caught saying
// 720p60 through that handle while the element, corrected, said 2160p60.
function correctReportedRung() {
    [player(), findPlayerApi()].forEach(correctOne);
}

function correctOne(showing) {
    if (!showing || correctedPlayer.has(showing)) return;

    if (typeof showing.getPlaybackQuality !== 'function') return;

    correctedPlayer.add(showing);

    // Both readings, from the same rung. The player's own pipeline is fed into a buffer
    // that discards everything, so whatever it settled on describes nothing anybody is
    // watching — but only while this app is the one feeding the element.
    const keep = untouched.get(showing) || {};
    untouched.set(showing, keep);

    const correct = (name, take) => {
        const real = showing[name];
        if (typeof real !== 'function') return;

        keep[name] = real;

        showing[name] = function () {
            const said = real.apply(this, arguments);

            if (!serving || !serving.video || !playingOurs()) return said;

            const height = showingHeight();
            const rung = rungFor(height);
            if (rung) return take(rung) || said;

            // The ladder arrives with the page and this can be asked before it has. What
            // is being served is known either way, and a plain height beats the number the
            // player's own pipeline settled on, which nobody is watching.
            return synthesise(name, height) || said;
        };
    };

    correct('getPlaybackQuality', (rung) => rung.quality);
    correct('getPlaybackQualityLabel', (rung) => rung.qualityLabel);

    // And the one the menu actually reads. `getVideoData().video_quality` is the player's
    // own adaptive state, and it decays while the picture does not: caught at hd1440 and
    // then hd1080 over an unchanging 3840x2160, because its pipeline is fed into a buffer
    // that keeps nothing and its ladder walks down looking for something that will play.
    // Correcting the two methods above moved the tick and the label; this is the field
    // behind both in the menu's own rendering.
    const data = showing.getVideoData;

    if (typeof data === 'function') {
        keep.getVideoData = data;

        showing.getVideoData = function () {
            const said = data.apply(this, arguments);

            if (!said || !serving || !serving.video || !playingOurs()) return said;

            const height = showingHeight();
            const rung = rungFor(height);
            const quality = (rung && rung.quality) || synthesise('getPlaybackQuality', height);
            if (!quality || said.video_quality === quality) return said;

            // A copy: this is YouTube's own object and the rest of it is none of our
            // business. Everything that reads it reads it, and `video_id` is unchanged.
            return Object.assign({}, said, { video_quality: quality });
        };
    }
}

// What the page's own player thinks, with nothing of ours in the way. Its adaptive ladder
// is the thing under test whenever the second download is being worked on, and it cannot
// be read through the corrected methods.
export function pagePlayerSays() {
    const ask = (target) => {
        const kept = target && untouched.get(target);
        if (!kept) return null;

        const call = (name) => {
            try {
                return typeof kept[name] === 'function' ? kept[name].call(target) : null;
            } catch (e) {
                return null;
            }
        };

        const data = call('getVideoData');

        return {
            quality: call('getPlaybackQuality'),
            label: call('getPlaybackQualityLabel'),
            videoQuality: data ? data.video_quality : null
        };
    };

    return { api: ask(findPlayerApi()), element: ask(player()) };
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

        // One at a time per video, or a stream left from the previous attempt goes on
        // downloading beside its replacement.
        //
        // Closing by id is not enough on its own: the entry is set to null while a session
        // is opening, so a response arriving in that window found nothing to close and the
        // half-open session was then overwritten and lost. It survived until the idle
        // sweeper reclaimed it — seen on the television as a 2160p stream still fetching
        // sixty-three seconds after a quality change had replaced it with 1080p, both
        // pulling at once, which is what a seek followed by a quality change felt like.
        // Every attempt is numbered now, and one that finishes after being superseded
        // closes itself.
        const previous = opened.get(request.videoId);
        if (previous) closeSession(previous);

        const attempt = (attempts.get(request.videoId) || 0) + 1;
        attempts.set(request.videoId, attempt);

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
                const superseded = attempts.get(request.videoId) !== attempt;
                if (superseded || !opened.has(request.videoId)) return closeSession(session.id);

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

    watchSeeks();

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
