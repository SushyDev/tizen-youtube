'use strict';

// Pulls YouTube's media over SABR. Every adaptive format above 360p is served that way and
// carries no url of its own, so the media cannot be fetched without the session the page
// opened — see `observed` for which parts of it can only come from the page.

const crypto = require('crypto');

const {
    SabrStream, EnabledTrackTypes, buildSabrFormat, VideoPlaybackAbrRequest
} = require('../vendor/googlevideo.cjs');

// A stream nobody has read from in this long is abandoned, not paused.
const IDLE_TIMEOUT = 120000;

// googlevideo sends none of these, and the endpoint answers 403 to a request that does not
// look like the client the session was opened for.
const ORIGIN = 'https://www.youtube.com';

// YouTube's own alphabet for a client playback nonce.
const NONCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const sessions = new Map();

// The session, read off the page's own SABR requests as they pass through the proxy.
//
// Three things in one cannot be rebuilt here: the streaming url carries an `n` the player
// descrambles with a function it downloads, the PO token is minted in the page by BotGuard,
// and the ustreamer config has to be the one that went with them. A request missing any of
// those is answered 403, or malformed_config, which names nothing.
const observed = {
    session: null,

    /** Whether a proxied request is one the session can be read out of. */
    wants(method, url) {
        return method === 'POST' && url.indexOf('videoplayback') !== -1;
    },

    note(url, body) {
        try {
            const request = VideoPlaybackAbrRequest.decode(body);
            const context = request.streamerContext || {};
            const streamingUrl = new URL(url);

            // The page numbers its own requests; ours are numbered from our own count.
            streamingUrl.searchParams.delete('rn');

            observed.session = {
                at: Date.now(),
                streamingUrl: streamingUrl.toString(),

                // What the page's own player chose. An itag alone does not name a format:
                // the same one appears more than once with different `xtags` — a dubbed
                // track, or the same audio with its dynamic range compressed — and picking
                // between them by bitrate is picking at random.
                selected: (request.selectedFormatIds || []).map((format) => ({
                    itag: Number(format.itag),
                    xtags: format.xtags || ''
                })),
                poToken: context.poToken && context.poToken.length
                    ? Buffer.from(context.poToken).toString('base64')
                    : null,
                ustreamerConfig: request.videoPlaybackUstreamerConfig
                    ? Buffer.from(request.videoPlaybackUstreamerConfig).toString('base64')
                    : null,
                clientInfo: context.clientInfo || null
            };
        } catch (e) {
            // A request shaped differently than expected is not worth failing playback for.
        }
    }
};

// The player response spells its config in the url-safe alphabet and the request in the
// standard one, so the same bytes do not compare equal as text.
function sameConfig(a, b) {
    const bytes = (value) => Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return bytes(a).equals(bytes(b));
}

/**
 * Waits until the proxy has seen a SABR request for the same video as the config given.
 * Asking before the player has made one is the ordinary case, not an error.
 */
function awaitSession(ustreamerConfig, timeout, after) {
    const deadline = Date.now() + (timeout || 15000);

    const matches = () => {
        const session = observed.session;
        if (!session || !session.streamingUrl) return null;
        if (ustreamerConfig && session.ustreamerConfig
            && !sameConfig(ustreamerConfig, session.ustreamerConfig)) return null;

        // Opening the same video again means the viewer changed something about it, and
        // what they chose is in the request the player has yet to make. The one before it
        // names the old choice and matches just as well.
        if (after && session.at <= after) return null;

        return session;
    };

    return new Promise((resolve, reject) => {
        const look = () => {
            const found = matches();
            if (found) return resolve(found);

            if (Date.now() > deadline) {
                return reject(new Error('the page never made a request this stream could be taken from'));
            }
            setTimeout(look, 50);
        };

        look();
    });
}

/** Everything SABR needs, as the page reads it out of the player response. */
function validate(params) {
    const missing = ['streamingUrl', 'ustreamerConfig', 'formats', 'durationMs']
        .filter((name) => !params || params[name] === undefined || params[name] === null);

    if (missing.length) throw new Error(`missing ${missing.join(', ')}`);
    if (!Array.isArray(params.formats) || !params.formats.length) throw new Error('no formats');

    // A live stream reports no length, and SABR reads up to the duration it is given: with
    // none it closes both tracks before a byte arrives.
    if (!(Number(params.durationMs) > 0)) {
        throw new Error('this response has no duration — a live stream cannot be packaged this way');
    }
}

/**
 * A playback nonce of our own, one per stream. The server tracks position against the `cpn`
 * in the url, so sharing the page's would resume where the page is and sharing one between
 * our two tracks would give them a single position. It is not a signed parameter.
 */
function ownSession(url) {
    const address = new URL(url);
    if (!address.searchParams.has('cpn')) return url;

    const bytes = crypto.randomBytes(16);
    let nonce = '';
    for (let i = 0; i < 16; i += 1) nonce += NONCE_ALPHABET[bytes[i] % NONCE_ALPHABET.length];

    address.searchParams.set('cpn', nonce);
    return address.toString();
}

/**
 * Carries the page's identity onto requests made on its behalf, and holds them while the
 * gate says to. The stream reads one request fully before asking for the next, so holding
 * here bounds read-ahead without aborting anything or queueing it up in memory instead.
 */
function fetcher(userAgent, gate) {
    const headersFor = (init) => {
        const headers = Object.assign({}, init && init.headers, {
            origin: ORIGIN,
            referer: `${ORIGIN}/`
        });

        if (userAgent) headers['user-agent'] = userAgent;
        return headers;
    };

    return (url, init) => Promise.resolve(gate ? gate() : null)
        .then(() => fetch(url, Object.assign({}, init, { headers: headersFor(init) })));
}

function open(input) {
    // What the page reads out of the player response, with the parts only a request in
    // flight can supply filled in.
    //
    // The caller may name the session to use. It should: the page makes requests for videos
    // it is only considering, so the latest one seen is not necessarily the one a stream was
    // opened against, and both tracks of a stream have to be built from the same one.
    const session = input.session || observed.session || {};
    const params = Object.assign({}, input, {
        streamingUrl: input.streamingUrl || session.streamingUrl,
        poToken: input.poToken || session.poToken,
        ustreamerConfig: session.ustreamerConfig || input.ustreamerConfig,
        clientInfo: input.clientInfo || session.clientInfo
    });

    // Formats belong to one video and the session to another only if the page moved on
    // between the two being read. The server answers that with malformed_config, which
    // says nothing about which half is stale.
    if (input.ustreamerConfig && session.ustreamerConfig && !sameConfig(input.ustreamerConfig, session.ustreamerConfig)) {
        throw new Error('the page has moved on: its formats and the observed session are for different videos');
    }

    validate(params);

    const stream = new SabrStream({ fetch: fetcher(params.userAgent, params.gate) });

    stream.setStreamingURL(ownSession(params.streamingUrl));
    stream.setUstreamerConfig(params.ustreamerConfig);
    stream.setServerAbrFormats(params.formats.map(buildSabrFormat));
    stream.setDurationMs(Number(params.durationMs));

    if (params.poToken) stream.setPoToken(params.poToken);
    if (params.clientInfo) stream.setClientInfo(params.clientInfo);

    return stream;
}

/**
 * Opens a stream and reads from it for a while, reporting what arrived. This is the
 * question the whole approach rests on — whether SABR can be spoken from the television
 * at all — and it is cheaper to answer with a byte count than with a player.
 */
async function measure(params, seconds) {
    const stream = open(params);

    const protection = [];
    stream.on('streamProtectionStatusUpdate', (status) => protection.push(status && status.status));

    const started = Date.now();
    const { videoStream, audioStream, selectedFormats } = await stream.start({
        videoQuality: params.videoQuality || '1080p',
        audioQuality: params.audioQuality || 'AUDIO_QUALITY_MEDIUM',
        enabledTrackTypes: EnabledTrackTypes.VIDEO_AND_AUDIO,
        preferWebM: false,
        preferOpus: false
    });

    const counts = { video: 0, audio: 0 };

    // Reading stops by aborting the stream, not by cancelling the readers: googlevideo
    // keeps enqueuing what is already in flight, and a cancelled reader closes the
    // controller under it.
    const timer = setTimeout(() => stream.abort(), seconds * 1000);

    // Both tracks are read: SABR interleaves them in one response, so draining only one
    // stalls the other and measures backpressure rather than throughput.
    const drain = async (readable, name) => {
        const reader = readable.getReader();
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                counts[name] += value.byteLength;
            }
        } catch (e) {
            // The abort above ends the read; anything else is worth knowing about.
            if (!/abort/i.test(e.message)) throw e;
        }
    };

    await Promise.all([drain(videoStream, 'video'), drain(audioStream, 'audio')]);
    clearTimeout(timer);
    stream.abort();

    const elapsed = (Date.now() - started) / 1000;

    return {
        seconds: +elapsed.toFixed(2),
        videoBytes: counts.video,
        audioBytes: counts.audio,
        megabitsPerSecond: +(((counts.video + counts.audio) * 8) / elapsed / 1e6).toFixed(2),
        protection,
        videoFormat: describe(selectedFormats && selectedFormats.videoFormat),
        audioFormat: describe(selectedFormats && selectedFormats.audioFormat)
    };
}

/**
 * One track's bytes, in order, as the server sends them. Nothing is interpreted here: what
 * SABR delivers is exactly what YouTube's own DASH file is made of, and the caller knows
 * from the file's own segment index where each segment begins and ends.
 *
 * One track per stream. Sharing one between both makes the server carry a single position
 * for the pair, and the second track comes back wherever the first left off.
 */
async function follow(input, options) {
    const stream = open(input);

    // What the server says about each format, which is what a later request needs to name a
    // position in the same file.
    if (options.onFormat) {
        stream.on('formatInitialization', (initialized) => {
            const metadata = initialized.formatInitializationMetadata || {};
            const id = metadata.formatId || {};
            options.onFormat(`${id.itag}:${id.xtags || ''}`, metadata);
        });
    }

    const { videoStream, audioStream } = await stream.start({
        // As formats rather than itags: an itag can name more than one of them, and asking
        // by number takes whichever came first.
        videoFormat: buildSabrFormat(options.videoFormat),
        audioFormat: buildSabrFormat(options.audioFormat),
        enabledTrackTypes: options.kind === 'video' ? EnabledTrackTypes.VIDEO_ONLY : EnabledTrackTypes.AUDIO_ONLY,
        state: options.state || undefined
    });

    const reader = (options.kind === 'video' ? videoStream : audioStream).getReader();

    return {
        reader,
        abort() {
            reader.cancel().catch(() => { /* already closing */ });
            stream.abort();
        }
    };
}

function describe(format) {
    if (!format) return null;
    return {
        itag: format.itag,
        mime: format.mimeType,
        width: format.width,
        height: format.height,
        fps: format.fps,
        bitrate: format.bitrate
    };
}

/** Drops streams that were opened and then forgotten. */
function sweep() {
    const now = Date.now();
    sessions.forEach((session, id) => {
        if (now - session.touchedAt < IDLE_TIMEOUT) return;
        try { session.stream.abort(); } catch (e) { /* already gone */ }
        sessions.delete(id);
    });
}

module.exports = { awaitSession, follow, measure, observed, open, sessions, sweep };
