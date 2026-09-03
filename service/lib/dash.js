'use strict';

// Serves YouTube's media back to the page as DASH on localhost, because a video element
// fed a URL plays 2160p60 here without dropping frames and the same media through
// MediaSource does not. The manifest covers the whole video from the first moment; a
// segment the player reaches before the download does is waited for, not refused.

const express = require('express');
const { createReadStream } = require('fs');
const { open, readFile } = require('fs/promises');

const hls = require('./hls.js');
const mux = require('./mux.js');
const journal = require('./journal.js');
const sabr = require('./sabr.js');
const stream = require('./stream.js');

// The coding-independent code points a manifest states colour with. The set reads these to
// decide whether to switch the panel into HDR; without them it decodes wide-gamut video and
// shows it as if it were ordinary, which looks worse than not offering HDR at all.
const CICP = {
    COLOR_PRIMARIES_BT2020: 9,
    COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084: 16,
    COLOR_TRANSFER_CHARACTERISTICS_ARIB_STD_B67: 18
};

/**
 * The colour of the picture, said in the manifest so the set can act on it.
 *
 * Only worth stating when it is not ordinary video: BT.709 is what everything assumes, and
 * saying it changes nothing. BT.2020 with one of the two HDR curves is what makes the panel
 * switch, and the matrix goes with the primaries.
 */
function colourProperties(format) {
    const colour = format.colorInfo || {};
    if (colour.primaries !== 'COLOR_PRIMARIES_BT2020') return '';

    const transfer = CICP[colour.transferCharacteristics];
    const property = (name, value) =>
        `\n                <SupplementalProperty schemeIdUri="urn:mpeg:mpegB:cicp:${name}" value="${value}"/>`;

    return property('ColourPrimaries', CICP.COLOR_PRIMARIES_BT2020)
        + (transfer ? property('TransferCharacteristics', transfer) : '')
        + property('MatrixCoefficients', CICP.COLOR_PRIMARIES_BT2020);
}

// What the stats panel calls the two HDR curves. The response names them as the standards
// do — SMPTE ST 2084, ARIB STD-B67 — and stripping the prefix leaves `smptest2084`, which
// reads like a typo beside the panel's own rows. This row is written over the panel's, so
// it says what the panel would have said.
const CURVES = {
    smptest2084: 'smpte2084 (PQ)',
    arib_std_b67: 'arib-std-b67 (HLG)'
};

/** What the response says about a format's colour, in words the page can show. */
function colourOf(format) {
    const colour = format.colorInfo || {};
    if (!colour.primaries && !colour.transferCharacteristics) return null;

    const name = (value) => String(value || '')
        .replace('COLOR_PRIMARIES_', '')
        .replace('COLOR_TRANSFER_CHARACTERISTICS_', '')
        .toLowerCase();

    const transfer = name(colour.transferCharacteristics);

    return { primaries: name(colour.primaries), transfer: CURVES[transfer] || transfer };
}

function codecsOf(mimeType) {
    const match = /codecs="([^"]+)"/.exec(mimeType || '');
    return match ? match[1] : '';
}

const typeOf = (mimeType) => String(mimeType || '').split(';')[0];

/** ISO 8601 duration, which is the only form a manifest takes. */
const iso = (ms) => `PT${(ms / 1000).toFixed(3)}S`;

const escape = (text) => String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The segment timeline, with runs of equal-length segments written once.
 *
 * A segment element each meant a 2.5-hour video arrived as some three thousand of them
 * across the two tracks, and the set has to parse the whole thing before it can show a
 * frame — which is most of the black screen between pressing play and seeing anything.
 * YouTube cuts at a constant cadence, so nearly all of them collapse into a handful of
 * runs. `r` is the number of *additional* repeats, and this stays exact: a segment whose
 * length differs starts a new run rather than being rounded into the last one.
 */
function timelineOf(index) {
    const runs = [];

    index.forEach((segment, at) => {
        const last = runs[runs.length - 1];
        if (last && segment.durationMs === last.d) {
            last.r += 1;
            return;
        }

        runs.push({ d: segment.durationMs, r: 0, t: at === 0 ? segment.startMs : null });
    });

    return runs
        .map((run) => `<S${run.t === null ? '' : ` t="${run.t}"`} d="${run.d}"${run.r ? ` r="${run.r}"` : ''}/>`)
        .join('');
}

/**
 * The manifest, describing every segment of both tracks. It is written once and does not
 * change: the file's own index says how long each segment runs, so nothing about it depends
 * on how much has been downloaded.
 */
function manifest(session) {
    const set = (track, attributes, extra) => {
        const format = track.format;
        const timeline = timelineOf(track.index);

        return `
        <AdaptationSet contentType="${track.kind}" mimeType="${escape(typeOf(format.mimeType))}" startWithSAP="1" segmentAlignment="true">
            <Representation id="${track.kind}" codecs="${escape(codecsOf(format.mimeType))}" bandwidth="${format.bitrate || 0}"${attributes}>${extra}
                <SegmentTemplate timescale="1000" startNumber="${track.index[0].number}"
                                 initialization="${track.kind}/init.mp4" media="${track.kind}/$Number$.m4s">
                    <SegmentTimeline>${timeline}</SegmentTimeline>
                </SegmentTemplate>
            </Representation>
        </AdaptationSet>`;
    };

    const video = session.tracks.video;
    const audio = session.tracks.audio;
    const colour = colourProperties(video.format);

    return `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-live:2011"
     type="static" mediaPresentationDuration="${iso(session.durationMs)}" minBufferTime="PT2.0S">
    <Period id="0" duration="${iso(session.durationMs)}">${set(
        video,
        ` width="${video.format.width}" height="${video.format.height}" frameRate="${video.format.fps || 30}"`,
        colour
    )}${set(
        audio,
        audio.format.audioSampleRate ? ` audioSamplingRate="${audio.format.audioSampleRate}"` : '',
        audio.format.audioChannels
            ? `\n                <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${audio.format.audioChannels}"/>`
            : ''
    )}
    </Period>
</MPD>
`;
}

/** A session as the page should see it: what is playing, not where it is kept. */
function describe(session) {
    const track = ({ kind, format, index }) => ({
        kind,
        itag: format.itag,
        // The itag does not name a format on its own — dubbed tracks and compressed dynamic
        // range share one — so what the page compares against has to carry this too.
        xtags: format.xtags || '',
        codecs: codecsOf(format.mimeType),
        colour: colourOf(format),
        bitrate: format.bitrate || 0,
        width: format.width,
        height: format.height,
        fps: format.fps,
        mimeType: typeOf(format.mimeType),
        segments: index.length,

        // Which number the first one carries, and how long each runs. A page feeding these
        // to a source buffer itself has to ask for them by number and know when it has
        // enough — neither of which follows from the count alone.
        first: index[0].number,
        durationsMs: index.map((segment) => segment.durationMs)
    });

    return {
        id: session.id,
        videoId: session.videoId,
        durationMs: session.durationMs,
        video: track(session.tracks.video),
        audio: track(session.tracks.audio),

        // Whether this one can be served as a plain file. Roughly, since the head is a
        // couple of kilobytes against hundreds of megabytes of media.
        plainFileBytes: [session.tracks.video, session.tracks.audio]
            .reduce((total, one) => total + (one.index || [])
                .reduce((bytes, segment) => bytes + (segment.end - segment.start + 1), 0), 0)
    };
}

/** Everything the page needs, on the service's own origin. */
function attach(app) {
    // The page asks: it holds the formats, and the SABR session this uses came off its own
    // traffic through the proxy.
    app.post('/dash/open', express.json({ limit: '4mb' }), (req, res) => {
        stream.open(req.body || {}).then(
            (session) => res.json({ ok: true, session: describe(session) }),
            (error) => res.status(500).json({ ok: false, error: error.message })
        );
    });

    // What the page's own player is asking the servers for. It changes when the viewer
    // changes quality, audio track, stable volume or voice boost — every one of which is a
    // different format — so this is how the page sees that its stream no longer matches.
    app.get('/dash/selection', (_, res) => {
        const session = sabr.observed.session;
        res.json({ selected: (session && session.selected) || [] });
    });

    app.post('/dash/close', express.json({ limit: '8kb' }), (req, res) => {
        stream.close((req.body || {}).id).then(
            (closed) => res.json({ ok: true, closed }),
            (error) => res.status(500).json({ ok: false, error: error.message })
        );
    });

    // The page hands the player a URL for a video before the session for it exists — it
    // has to, because the player asks for one the moment the response lands. This waits,
    // then points at the real thing, so every relative URL inside the manifest resolves
    // against the session that answered.
    app.get('/dash/by-video/:videoId/progressive.mp4', (req, res) => {
        stream.awaitVideo(req.params.videoId).then(
            // Answering this with a redirect to the manifest was tried, for a file too
            // large to play as one — and refused: the set commits to reading an MP4 from
            // the address it was given and will not take a manifest in its place. So the
            // choice belongs to the page, which makes it from the sizes the player response
            // carries. This stays a plain file or nothing.
            (session) => res.redirect(302, `/dash/${session.id}/progressive.mp4`),
            (error) => res.status(404).send(error.message)
        );
    });

    // The same wait, for a set being handed HLS instead. Which description the page asks
    // for is the page's choice; both point at the same segments.
    app.get('/dash/by-video/:videoId/master.m3u8', (req, res) => {
        stream.awaitVideo(req.params.videoId).then(
            (session) => res.redirect(302, `/dash/${session.id}/master.m3u8`),
            (error) => res.status(404).send(error.message)
        );
    });

    app.get('/dash/by-video/:videoId/manifest.mpd', (req, res) => {
        stream.awaitVideo(req.params.videoId).then(
            (session) => res.redirect(302, `/dash/${session.id}/manifest.mpd`),
            // Not found rather than timed out, and said plainly: the page reads this as
            // "there is no stream here", drops back to its own player and carries on. A
            // video that cannot be served this way still plays.
            (error) => res.status(404).send(error.message)
        );
    });

    const find = (req, res) => {
        const session = stream.sessions.get(req.params.id);
        if (!session) res.status(404).send('no such session');
        else session.read = Date.now();
        return session || null;
    };

    app.get('/dash/:id/manifest.mpd', (req, res) => {
        const session = find(req, res);
        if (!session) return;

        // A session exists from the moment it is asked for; its manifest cannot be written
        // until both indexes have been read.
        if (!session.ready) return res.status(503).send('the stream is still opening');

        res.setHeader('Content-Type', 'application/dash+xml');
        res.send(manifest(session));
    });

    app.get('/dash/:id/master.m3u8', (req, res) => {
        const session = find(req, res);
        if (!session) return;

        if (!session.ready) return res.status(503).send('the stream is still opening');

        const playlist = hls.master(session);
        if (!playlist) return res.status(404).end();

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(playlist);
    });

    app.get('/dash/:id/:kind.m3u8', (req, res) => {
        const session = find(req, res);
        if (!session) return;

        if (!session.ready) return res.status(503).send('the stream is still opening');

        const playlist = hls.media(session, req.params.kind);
        if (!playlist) return res.status(404).end();

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(playlist);
    });

    // Both tracks as one plain file, which is the whole point: no manifest, no playlist,
    // nothing for the set to parse and make decisions about. It is handed bytes in order
    // and plays them, and on this hardware that is the only one of the three descriptions
    // which presents a 2160p60 picture cleanly.
    //
    // Seekable, because it has to be — a part-watched video that cannot resume is no use to
    // anybody. Every rewrite the muxer makes replaces four bytes with four bytes, and every
    // fragment's length is already in the segment index, so the file's whole shape is known
    // before any of it has been fetched: a real Content-Length, real byte ranges, and a
    // `sidx` in the head so the set can ask for a moment rather than guess at a byte.
    // An open-ended range is answered to the end of the file, and nothing less.
    //
    // Bounding it was tried, to twenty-four megabytes, because a set asking `bytes=0-` for a
    // nine-hundred-megabyte file could not cope with being handed all of it. The set does
    // not ask for the next range: it plays what it was given — twenty seconds, for a
    // sixty-three megabyte video cut at twenty-four — then jumps to the end of the file and
    // stops, because the duration in the header says there should have been more and there
    // is none. Watched on the television, a fifty-two second video ended after twenty.
    //
    // The file it was added for never reaches here now: anything too large to play as one
    // is asked for as a manifest instead, before a byte is served.

    // (declared above the routes so both the by-video redirect and the file itself use it)
    // How large a plain file this television will play at all.
    //
    // Measured by bisection, opening the same videos at different rungs: 63MB, 205MB,
    // 221MB, 385MB and 553MB all play; 684MB, 971MB and 1135MB never start — the set asks
    // for the first chunk, the service delivers it, and the element consumes nothing and
    // reports nothing. Fragment size is not what decides it: one file plays with 9.0MB
    // fragments and another fails with 9.6MB and three times the total.
    //
    // So the size is known before anything is handed over, and a file over it is not
    // offered. The page asks for a manifest instead, which has no such limit.
    const MAX_FILE = 600 * 1024 * 1024;

    const described = new Map();

    // Which request for a session is the live one. A seek makes the set open another before
    // it has closed the last, and it opens several in a burst while it settles on where it
    // wants to be — four inside a third of a second, measured. Each one was starting its own
    // walk through the file and asking the same track to fetch from a different place, so
    // they aborted one another's downloads in turn and the element was left with nothing at
    // all: readyState 0, the clock parked, no picture.
    //
    // Only the newest matters. The ones before it are abandoned where they stand.
    const serving = new Map();

    const shapeOf = async (session) => {
        const held = described.get(session.id);
        if (held) return held;

        const video = session.tracks.video;
        const audio = session.tracks.audio;
        if (!video || !audio || !video.index || !audio.index) return null;

        await Promise.all([video.reach(0), audio.reach(0)]);

        const shape = mux.describeFile(
            await readFile(video.file(0)),
            await readFile(audio.file(0)),
            video.index,
            audio.index
        );

        if (shape) described.set(session.id, shape);
        return shape;
    };

    // One fragment, out to the client, without holding it in memory.
    //
    // Everything the muxer rewrites lives in the `moof` at the front — a track id and a
    // sequence number, a few kilobytes in — and the `mdat` behind it is untouched. Reading
    // the whole fragment to change eight bytes meant two copies of it in memory at once:
    // thirty megabytes for one 2160p60 fragment, on a set that is decoding at the same
    // time. So the head is read and rewritten, and the rest is streamed off the disk.
    /** A write that waits when the client is not keeping up, rather than piling into memory. */
    const pushed = (res, chunk) => (res.write(chunk)
        ? Promise.resolve()
        : new Promise((drained) => res.once('drain', drained)));

    async function pourFragment(res, file, id, sequence, begin, finish) {
        const handle = await open(file, 'r');
        let headLength = 0;

        try {
            const header = Buffer.alloc(8);
            await handle.read(header, 0, 8, 0);

            // The `moof` is the first box of a fragment; anything else is not one this
            // wrote, and the safe answer is to send the bytes untouched.
            if (header.toString('latin1', 4, 8) === 'moof') headLength = header.readUInt32BE(0);

            if (headLength && begin < headLength) {
                const head = Buffer.alloc(headLength);
                await handle.read(head, 0, headLength, 0);

                const rewritten = mux.retrack(head, id, sequence);
                await pushed(res, rewritten.subarray(begin, Math.min(headLength, finish)));
            }
        } finally {
            await handle.close();
        }

        const start = Math.max(begin, headLength);
        if (start >= finish) return;

        await new Promise((done, failed) => {
            createReadStream(file, { start, end: finish - 1 })
                .on('error', failed)
                .on('end', done)
                .pipe(res, { end: false });
        });
    }

    app.get('/dash/:id/progressive.mp4', async (req, res) => {
        const session = find(req, res);
        if (!session) return undefined;

        if (!session.ready) return res.status(503).send('the stream is still opening');

        let shape;
        try {
            shape = await shapeOf(session);
        } catch (error) {
            return res.status(503).end();
        }

        if (!shape) return res.status(404).end();

        if (shape.total > MAX_FILE) {
            journal.service('progressive', `${session.id}: ${Math.round(shape.total / 1048576)}MB `
                + 'is more than this set will play as a plain file; ask for the manifest');
            return res.status(413).end();
        }

        const asked = mux.rangeOf(req.get('range'), shape.total);

        if (asked && asked.unsatisfiable) {
            res.setHeader('Content-Range', `bytes */${shape.total}`);
            return res.status(416).end();
        }

        const from = asked ? asked.from : 0;
        const to = asked ? asked.to : shape.total - 1;

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', to - from + 1);

        if (asked) {
            res.setHeader('Content-Range', `bytes ${from}-${to}/${shape.total}`);
            res.status(206);
        }

        if (req.method === 'HEAD') return res.end();

        const mine = (serving.get(session.id) || 0) + 1;
        serving.set(session.id, mine);

        // A request the set walks away from should stop costing anything.
        let gone = false;
        res.on('close', () => { gone = true; });

        const current = () => !gone && !res.writableEnded && serving.get(session.id) === mine;

        journal.service('progressive', `${session.id}: `
            + `${asked ? `bytes ${from}-${to}` : 'the whole file'} of ${shape.total}`);

        // Where the head still has something to say, it goes first.
        if (from < shape.head.length) {
            res.write(shape.head.subarray(from, Math.min(shape.head.length, to + 1)));
        }

        const send = async (at) => {
            if (!current()) return res.end();
            if (at >= shape.parts.length) return res.end();

            const part = shape.parts[at];

            // Behind what was asked for, or past the end of it.
            if (part.offset + part.size - 1 < from) return send(at + 1);
            if (part.offset > to) return res.end();

            const track = session.tracks[part.kind];
            track.want(part.number);

            try {
                await track.reach(part.number);
            } catch (error) {
                return res.end();
            }

            // Another request arrived while this one waited for bytes; it decides now.
            if (!current()) return res.end();

            const id = part.kind === 'video' ? mux.VIDEO_TRACK : mux.AUDIO_TRACK;
            const begin = Math.max(0, from - part.offset);
            const finish = Math.min(part.size, to - part.offset + 1);

            try {
                await pourFragment(res, track.file(part.number), id, at + 1, begin, finish);
            } catch (error) {
                return res.end();
            }

            return send(at + 1);
        };

        return send(0);
    });

    // One track as a plain file, for a browser that will not parse a manifest. Desktop
    // Chrome plays fragmented MP4 from a URL but has no DASH of its own, so this is what
    // makes the page testable anywhere other than the television it is written for.
    app.get('/dash/:id/:kind.mp4', (req, res) => {
        const session = find(req, res);
        if (!session) return;

        const track = session.tracks[req.params.kind];
        if (!track || !track.index) return res.status(404).end();

        res.setHeader('Content-Type', typeOf(track.format.mimeType));
        res.setHeader('Accept-Ranges', 'none');

        // Written as it arrives, in order, for as long as the player keeps reading.
        const pour = async (number) => {
            if (res.writableEnded || number > track.index[track.index.length - 1].number) return res.end();

            try {
                await track.reach(number);
            } catch (error) {
                return res.end();
            }

            track.want(number);
            createReadStream(track.file(number))
                .on('end', () => pour(number + 1))
                .on('error', () => res.end())
                .pipe(res, { end: false });

            return undefined;
        };

        return track.reach(0).then(
            () => createReadStream(track.file(0))
                .on('end', () => pour(track.index[0].number))
                .pipe(res, { end: false }),
            () => res.status(503).end()
        );
    });

    app.get('/dash/:id/:kind/init.mp4', (req, res) => {
        const session = find(req, res);
        if (!session) return;

        send(session, req.params.kind, 0, res);
    });

    app.get('/dash/:id/:kind/:number.m4s', (req, res) => {
        const session = find(req, res);
        if (!session) return;

        send(session, req.params.kind, Number(req.params.number), res);
    });
}

/** Waits for a segment to be on disk, then sends it. */
function send(session, kind, number, res) {
    const track = session.tracks[kind];
    if (!track) return res.status(404).end();
    if (!stream.locate(track, number)) return res.status(404).end();

    // Where the player has reached decides what is fetched next and what is deleted, so
    // asking for a segment is what moves the window along — for both tracks, because the
    // player asks about one at a time and they share a position.
    track.want(number);
    if (number > 0) stream.align(session, kind, number);

    return track.reach(number).then(
        () => {
            const at = stream.locate(track, number);

            res.setHeader('Content-Type', typeOf(track.format.mimeType));
            res.setHeader('Content-Length', at.end - at.start + 1);
            res.setHeader('Accept-Ranges', 'none');

            createReadStream(track.file(number)).pipe(res);
        },
        (error) => {
            journal.service('segment', `${kind} ${number} refused: ${error.message}`);
            if (!res.headersSent) res.status(503).end();
        }
    );
}

module.exports = { attach, describe, manifest, send };
