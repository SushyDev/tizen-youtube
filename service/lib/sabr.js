'use strict';

// Pulls YouTube's media over SABR. Every adaptive format above 360p is served that way
// and carries no url of its own, so the media cannot be fetched without the session the
// page opened.

const crypto = require('crypto');

const journal = require('./journal.js');

const {
    SabrStream, EnabledTrackTypes, buildSabrFormat, VideoPlaybackAbrRequest
} = require('../vendor/googlevideo.cjs');

const IDLE_TIMEOUT = 120000;

// googlevideo sends none of these, and the endpoint answers 403 to a request that does
// not look like the client the session was opened for.
const ORIGIN = 'https://www.youtube.com';

const NONCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const sessions = new Map();

// Read off the page's own SABR requests through the proxy, because three things in it
// cannot be rebuilt here: the `n` in the streaming url, the PO token BotGuard mints, and
// the ustreamer config that went with them. Missing any one is answered 403, or
// malformed_config, which names nothing.
const observed = {
    session: null,

    wants(method, url) {
        return method === 'POST' && url.indexOf('videoplayback') !== -1;
    },

    note(url, body) {
        try {
            const request = VideoPlaybackAbrRequest.decode(body);
            const context = request.streamerContext || {};
            const streamingUrl = new URL(url);

            // Decoding proves nothing: protobuf reads almost any bytes as a message with
            // none of the fields set, and the player also POSTs here for a single format at
            // a time. What makes a request one of ours is the ustreamer config plus the
            // absence of an itag in the address, since a SABR endpoint names no format.
            if (!request.videoPlaybackUstreamerConfig
                || !request.videoPlaybackUstreamerConfig.length
                || streamingUrl.searchParams.has('itag')) return;

            streamingUrl.searchParams.delete('rn');

            const was = observed.session;

            observed.session = {
                at: Date.now(),
                streamingUrl: streamingUrl.toString(),

                // An itag alone does not name a format: the same one appears more than once with
                // different `xtags` — a dubbed track, or the same audio with its dynamic range compressed
                // — and picking between them by bitrate is picking at random.
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

            if (!was || was.streamingUrl !== observed.session.streamingUrl) {
                journal.service('sabr', `session from ${observed.session.selected.length} `
                    + `selected format(s), ${observed.session.poToken ? 'with' : 'without'} a token`);
            }
        } catch (e) {
        }
    }
};

// The player response spells its config in the url-safe alphabet and the request in the
// standard one, so the same bytes do not compare equal as text.
function sameConfig(a, b) {
    const bytes = (value) => Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return bytes(a).equals(bytes(b));
}

function awaitSession(ustreamerConfig, timeout, after) {
    const deadline = Date.now() + (timeout || 15000);

    const matches = () => {
        const session = observed.session;
        if (!session || !session.streamingUrl) return null;
        if (ustreamerConfig && session.ustreamerConfig
            && !sameConfig(ustreamerConfig, session.ustreamerConfig)) return null;

        // Opening the same video again means the viewer changed something, and what they chose is
        // in the request the player has yet to make: the one before it names the old choice and
        // matches just as well.
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

// One per stream: the server tracks position against the `cpn` in the url, so sharing the
// page's would resume where the page is.
function ownSession(url) {
    const address = new URL(url);
    if (!address.searchParams.has('cpn')) return url;

    const bytes = crypto.randomBytes(16);
    let nonce = '';
    for (let i = 0; i < 16; i += 1) nonce += NONCE_ALPHABET[bytes[i] % NONCE_ALPHABET.length];

    address.searchParams.set('cpn', nonce);
    return address.toString();
}

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
    // The caller should name the session to use: the page makes requests for videos it is
    // only considering, so the latest one seen is not necessarily the one a stream was opened
    // against, and both tracks of a stream have to be built from the same one.
    const session = input.session || observed.session || {};
    const params = Object.assign({}, input, {
        streamingUrl: input.streamingUrl || session.streamingUrl,
        poToken: input.poToken || session.poToken,
        ustreamerConfig: session.ustreamerConfig || input.ustreamerConfig,
        clientInfo: input.clientInfo || session.clientInfo
    });

    // Formats belong to one video and the session to another only if the page moved on
    // between the two being read. The server answers that with malformed_config, which says
    // nothing about which half is stale.
    if (input.ustreamerConfig && session.ustreamerConfig && !sameConfig(input.ustreamerConfig, session.ustreamerConfig)) {
        throw new Error('the page has moved on: its formats and the observed session are for different videos');
    }

    validate(params);

    const stream = new SabrStream({ fetch: fetcher(params.userAgent, params.gate) });

    stream.setStreamingURL(params.keepCpn ? params.streamingUrl : ownSession(params.streamingUrl));
    stream.setUstreamerConfig(params.ustreamerConfig);
    stream.setServerAbrFormats(params.formats.map(buildSabrFormat));
    stream.setDurationMs(Number(params.durationMs));

    if (params.poToken) stream.setPoToken(params.poToken);
    if (params.clientInfo) stream.setClientInfo(params.clientInfo);

    return stream;
}

async function follow(input, options) {
    const stream = open(input);

    if (options.onFormat) {
        stream.on('formatInitialization', (initialized) => {
            const metadata = initialized.formatInitializationMetadata || {};
            const id = metadata.formatId || {};
            options.onFormat(`${id.itag}:${id.xtags || ''}`, metadata);
        });
    }

    const { videoStream, audioStream } = await stream.start({
        // As formats rather than itags: an itag can name more than one of them, and asking by
        // number takes whichever came first.
        videoFormat: buildSabrFormat(options.videoFormat),
        audioFormat: buildSabrFormat(options.audioFormat),
        enabledTrackTypes: options.kind === 'video' ? EnabledTrackTypes.VIDEO_ONLY : EnabledTrackTypes.AUDIO_ONLY,
        state: options.state || undefined
    });

    const reader = (options.kind === 'video' ? videoStream : audioStream).getReader();

    return {
        reader,
        abort() {
            reader.cancel().catch(() => { });
            stream.abort();
        }
    };
}

function sweep() {
    const now = Date.now();
    sessions.forEach((session, id) => {
        if (now - session.touchedAt < IDLE_TIMEOUT) return;
        try { session.stream.abort(); } catch (e) { }
        sessions.delete(id);
    });
}

module.exports = { awaitSession, follow, observed, open, sweep };
