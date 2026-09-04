'use strict';

const express = require('express');

const mux = require('./mux.js');
const journal = require('./journal.js');
const stream = require('./stream.js');

// The set reads these to decide whether to switch the panel into HDR; without them it
// decodes wide-gamut video and shows it as if it were ordinary.
const CICP = {
    COLOR_PRIMARIES_BT2020: 9,
    COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084: 16,
    COLOR_TRANSFER_CHARACTERISTICS_ARIB_STD_B67: 18
};

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

// What the stats panel calls the two HDR curves, which is not what the response names them.
const CURVES = {
    smptest2084: 'smpte2084 (PQ)',
    arib_std_b67: 'arib-std-b67 (HLG)'
};

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

const iso = (ms) => `PT${(ms / 1000).toFixed(3)}S`;

const escape = (text) => String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Runs of equal-length segments are written once, because the set parses the whole thing
// before it can show a frame. `r` counts *additional* repeats, and a segment of a
// different length starts a new run rather than being rounded into the last.
//
// A run may only be extended while the durations still add up to where the segment really
// begins. A player maps a seek to a segment number by counting those durations forward from
// the start of the timeline; this cuts segments at the starts the file actually has. Where
// the two drift apart the set asks for the segment it believes covers the target and is
// handed the one that covers a different moment — complete, correctly framed, correctly
// timed for the number it was cut as, and silently dropped. Sequential playback never
// notices, because media that arrives in order is played in order. A seek is the only place
// the mapping is used.
//
// So a segment whose real start has left the count begins a new run and states it. With an
// exact cadence that is one run and one start time, as before; with a ragged one it is a few
// more, and every number means the same thing at both ends.
function timelineOf(index) {
    const runs = [];
    let counted = null;
    let drift = 0;

    index.forEach((segment) => {
        const last = runs[runs.length - 1];

        // The file's own clock, not milliseconds. Converting to milliseconds rounds every
        // boundary and, worse, describes the timeline in units the media itself does not use:
        // the decode time inside each fragment is in these ticks, and a player told the
        // timeline is something else cannot line the two up. It gets away with it while
        // segments arrive in order and are played in order, and cannot at a seek, which is
        // the one place a time has to be turned into a segment and a segment placed at a time.
        // Falling back to the millisecond values for any index that does not carry ticks,
        // which is the same timeline whenever the clock is already milliseconds.
        const start = segment.startTicks === undefined ? segment.startMs : segment.startTicks;
        const length = segment.durationTicks === undefined ? segment.durationMs : segment.durationTicks;
        const adrift = counted === null || counted !== start;

        if (counted !== null) drift = Math.max(drift, Math.abs(counted - start));

        if (!adrift && last && length === last.d) last.r += 1;
        else runs.push({ d: length, r: 0, t: adrift ? start : null });

        counted = start + length;
    });

    if (drift) {
        journal.service('manifest', `counting durations forward misplaces a segment by up to `
            + `${drift} ticks; ${runs.length} runs state their own start`);
    }

    return runs
        .map((run) => `<S${run.t === null ? '' : ` t="${run.t}"`} d="${run.d}"${run.r ? ` r="${run.r}"` : ''}/>`)
        .join('');
}

// The live profile suits numbered segments fetched one at a time; on-demand suits one file
// with an index in it, which is what both tracks are described as now. Declaring the wrong
// one is not cosmetic — a reader is entitled to decide what a manifest supports from the
// profile it claims, and this claimed live while offering `SegmentBase` and an `indexRange`.
function profileFor(session) {
    const byIndex = Object.values(session.tracks).every((track) => track.cues && track.setup);

    return byIndex
        ? 'urn:mpeg:dash:profile:isoff-on-demand:2011'
        : 'urn:mpeg:dash:profile:isoff-live:2011';
}

function manifest(session) {
    const set = (track, attributes, extra) => {
        const format = track.format;

        // A track whose file states where its own index is gets described by that, rather
        // than by numbered segments invented on its behalf. This is how YouTube describes
        // WebM in its own manifests — one file, an `indexRange` over the cues — and a
        // platform's DASH reader is built against what YouTube serves. Numbered segments
        // are a fiction here: nothing in the file is addressable that way, and a set that
        // takes them for fragmented MP4 has no reason to take them for clusters.
        if (track.cues && track.setup) {
            return `
        <AdaptationSet contentType="${track.kind}" mimeType="${escape(typeOf(format.mimeType))}" startWithSAP="1" segmentAlignment="true">
            <Representation id="${track.kind}" codecs="${escape(codecsOf(format.mimeType))}" bandwidth="${format.bitrate || 0}"${attributes}>${extra}
                <BaseURL>${track.kind}/media</BaseURL>
                <SegmentBase indexRange="${track.cues.start}-${track.cues.end}" indexRangeExact="true">
                    <Initialization range="${track.setup.start}-${track.setup.end}"/>
                </SegmentBase>
            </Representation>
        </AdaptationSet>`;
        }

        const timeline = timelineOf(track.index);

        return `
        <AdaptationSet contentType="${track.kind}" mimeType="${escape(typeOf(format.mimeType))}" startWithSAP="1" segmentAlignment="true">
            <Representation id="${track.kind}" codecs="${escape(codecsOf(format.mimeType))}" bandwidth="${format.bitrate || 0}"${attributes}>${extra}
                <SegmentTemplate timescale="${track.timescale || 1000}" startNumber="${track.index[0].number}"
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
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="${profileFor(session)}"
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

function describe(session) {
    const track = ({ kind, format, index }) => ({
        kind,
        itag: format.itag,
        // Dubbed tracks and compressed dynamic range share an itag, so it does not name a format
        // on its own.
        xtags: format.xtags || '',
        codecs: codecsOf(format.mimeType),

        // Named rather than inferred from the codec. What the page does when a seek wedges
        // depends on it, and guessing the container from a codec string is the kind of
        // shortcut that is right until YouTube offers VP9 in something else.
        container: /^(video|audio)\/mp4/.test(format.mimeType || '') ? 'mp4' : 'webm',
        colour: colourOf(format),
        bitrate: format.bitrate || 0,
        width: format.width,
        height: format.height,
        fps: format.fps,
        mimeType: typeOf(format.mimeType),
        segments: index.length,

        // A page feeding these to a source buffer itself asks for them by number and needs to
        // know when it has enough, neither of which follows from the count alone.
        first: index[0].number,
        durationsMs: index.map((segment) => segment.durationMs)
    });

    return {
        id: session.id,
        videoId: session.videoId,
        durationMs: session.durationMs,
        video: track(session.tracks.video),
        audio: track(session.tracks.audio),

        // Excludes the head, which is kilobytes against hundreds of megabytes of media.
        plainFileBytes: [session.tracks.video, session.tracks.audio]
            .reduce((total, one) => total + (one.index || [])
                .reduce((bytes, segment) => bytes + (segment.end - segment.start + 1), 0), 0)
    };
}

function attach(app) {
    app.post('/dash/open', express.json({ limit: '4mb' }), (req, res) => {
        stream.open(req.body || {}).then(
            (session) => res.json({ ok: true, session: describe(session) }),
            (error) => res.status(500).json({ ok: false, error: error.message })
        );
    });

    app.post('/dash/close', express.json({ limit: '8kb' }), (req, res) => {
        stream.close((req.body || {}).id).then(
            (closed) => res.json({ ok: true, closed }),
            (error) => res.status(500).json({ ok: false, error: error.message })
        );
    });

    // The player asks for a URL the moment the response lands, before the session exists, so
    // these wait and then redirect: relative URLs inside the manifest then resolve against
    // the session that answered rather than against the video.
    //
    // Never redirected across descriptions: the set commits to reading an MP4 from the
    // address it was given and will not take a manifest in its place.
    app.get('/dash/by-video/:videoId/progressive.mp4', (req, res) => {
        stream.awaitVideo(req.params.videoId).then(
            (session) => res.redirect(302, `/dash/${session.id}/progressive.mp4`),
            (error) => res.status(404).send(error.message)
        );
    });

    app.get('/dash/by-video/:videoId/manifest.mpd', (req, res) => {
        stream.awaitVideo(req.params.videoId).then(
            (session) => {
                // `?at=` rather than `#t=`. A media fragment is stripped by the browser before
                // the request, so a resume or a seek reached this as a load from the very
                // beginning and a jump afterwards — the stream fetching from segment one while
                // the viewer sat somewhere else entirely. A query survives, so the stream can
                // be put where the viewer is before a single byte is served.
                const at = Math.floor(Number(req.query && req.query.at) || 0);

                if (at > 0) {
                    journal.service('seek', `${session.id} asked to open at ${at}s`);
                    stream.beginAt(session, at * 1000);
                }

                res.redirect(302, `/dash/${session.id}/manifest.mpd`);
            },
            // Not found rather than timed out, which the page reads as "no stream here" and answers
            // by dropping back to its own player.
            (error) => res.status(404).send(error.message)
        );
    });

    const find = (req, res) => {
        const session = stream.sessions.get(req.params.id);

        // A miss is not a curiosity. The set commits to an address when it takes the
        // manifest and asks for fragments under it for the rest of the video, so a session
        // that has gone while the element is still attached ends the video then and there:
        // no error is set, no event fires, the picture simply stops. It went unrecorded
        // until it was found by asking the server for a fragment by hand.
        if (!session) {
            journal.service('segment', `${req.params.id} is gone; refusing ${req.path}`);
            res.status(404).send('no such session');
        } else {
            session.read = Date.now();
        }

        return session || null;
    };

    // The element says nothing about playback, so the only sign of life the sweeper had was
    // a fragment request — and a player holding thirty seconds of read-ahead, or paused, or
    // one that has been handed the whole of a short video, makes none for far longer than
    // the idle timeout. The page says so instead, for as long as it is on the video.
    app.get('/dash/:id/alive', (req, res) => {
        const session = find(req, res);
        if (!session) return;

        res.json({ ok: true });
    });

    app.get('/dash/:id/manifest.mpd', (req, res) => {
        const session = find(req, res);
        if (!session) return;

        // A session exists from the moment it is asked for; its manifest cannot be written until
        // both indexes have been read.
        if (!session.ready) return res.status(503).send('the stream is still opening');

        res.setHeader('Content-Type', 'application/dash+xml');
        res.send(manifest(session));
    });

    // Beyond this the set asks for the first chunk of a plain file and then consumes nothing,
    // reporting no error. Measured by bisection: 553MB plays, 684MB does not.
    // `PLAIN_FILE_LIMIT` in the userscript is the same number, since the page has to choose a
    // description before the service is asked anything.
    const MAX_FILE = 600 * 1024 * 1024;

    const described = new Map();

    // Which request for a session is the live one. A seek opens several in a burst, and each
    // one walking the file separately has them abort one another's downloads in turn, leaving
    // the element with nothing at all. Only the newest is served.
    const serving = new Map();

    const shapeOf = async (session) => {
        const held = described.get(session.id);
        if (held) return held;

        const video = session.tracks.video;
        const audio = session.tracks.audio;
        if (!video || !audio || !video.index || !audio.index) return null;

        await Promise.all([video.reach(0), audio.reach(0)]);

        const shape = mux.describeFile(
            await video.bytes(0),
            await audio.bytes(0),
            video.index,
            audio.index
        );

        if (shape) described.set(session.id, shape);
        return shape;
    };

    const pushed = (res, chunk) => (res.write(chunk)
        ? Promise.resolve()
        : new Promise((drained) => res.once('drain', drained)));

    // Only the `moof` at the front is rewritten and the `mdat` behind it is streamed off the
    // disk: reading a whole 2160p60 fragment to change eight bytes put thirty megabytes in
    // memory twice over, on a set that is decoding at the same time.
    async function pourFragment(res, track, number, id, sequence, begin, finish) {
        const header = await track.head(number, 8);
        let headLength = 0;

        // Anything else is not a fragment this wrote, so the bytes go out untouched.
        if (header.length === 8 && header.toString('latin1', 4, 8) === 'moof') {
            headLength = header.readUInt32BE(0);
        }

        if (headLength && begin < headLength) {
            const rewritten = mux.retrack(await track.head(number, headLength), id, sequence);
            await pushed(res, rewritten.subarray(begin, Math.min(headLength, finish)));
        }

        const start = Math.max(begin, headLength);
        if (start >= finish) return;

        await new Promise((done, failed) => {
            track.pour(number, start, finish - 1)
                .on('error', failed)
                .on('end', done)
                .pipe(res, { end: false });
        });
    }

    // Which held pieces a byte range falls across, in order, and the part of each that the
    // range actually wants.
    async function pourAcross(res, track, from, to) {
        const pieces = [];

        if (track.init && track.init.end >= from && track.init.start <= to) {
            pieces.push({ number: 0, start: track.init.start, end: track.init.end });
        }

        (track.index || []).forEach((segment) => {
            if (segment.end < from || segment.start > to) return;
            pieces.push({ number: segment.number, start: segment.start, end: segment.end });
        });

        for (const piece of pieces) {
            track.want(piece.number);
            await track.reach(piece.number);

            const begin = Math.max(from, piece.start) - piece.start;
            const finish = Math.min(to, piece.end) - piece.start;

            await new Promise((done, failed) => {
                track.pour(piece.number, begin, finish)
                    .on('error', failed)
                    .on('end', done)
                    .pipe(res, { end: false });
            });
        }
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

        let gone = false;
        res.on('close', () => { gone = true; });

        const current = () => !gone && !res.writableEnded && serving.get(session.id) === mine;

        journal.service('progressive', `${session.id}: `
            + `${asked ? `bytes ${from}-${to}` : 'the whole file'} of ${shape.total}`);

        if (from < shape.head.length) {
            res.write(shape.head.subarray(from, Math.min(shape.head.length, to + 1)));
        }

        const send = async (at) => {
            if (!current()) return res.end();
            if (at >= shape.parts.length) return res.end();

            const part = shape.parts[at];

            if (part.offset + part.size - 1 < from) return send(at + 1);
            if (part.offset > to) return res.end();

            const track = session.tracks[part.kind];
            track.want(part.number);

            try {
                await track.reach(part.number);
            } catch (error) {
                return res.end();
            }

            if (!current()) return res.end();

            const id = part.kind === 'video' ? mux.VIDEO_TRACK : mux.AUDIO_TRACK;
            const begin = Math.max(0, from - part.offset);
            const finish = Math.min(part.size, to - part.offset + 1);

            try {
                await pourFragment(res, track, part.number, id, at + 1, begin, finish);
            } catch (error) {
                return res.end();
            }

            return send(at + 1);
        };

        return send(0);
    });

    // The file as one resource, answered by range. Nothing is held whole — the window is a
    // few segments — so a range is mapped back onto the segments that cover it and served
    // from those, fetching any that are missing exactly as a numbered request would.
    app.get('/dash/:id/:kind/media', async (req, res) => {
        const session = find(req, res);
        if (!session) return undefined;

        const track = session.tracks[req.params.kind];
        if (!track || !track.index || !track.index.length) return res.status(404).end();

        const last = track.index[track.index.length - 1];
        const total = last.end + 1;
        const asked = mux.rangeOf(req.get('range'), total);

        if (asked && asked.unsatisfiable) {
            res.setHeader('Content-Range', `bytes */${total}`);
            return res.status(416).end();
        }

        const from = asked ? asked.from : 0;
        const to = asked ? asked.to : total - 1;

        res.setHeader('Content-Type', typeOf(track.format.mimeType));
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', to - from + 1);

        if (asked) {
            res.status(206);
            res.setHeader('Content-Range', `bytes ${from}-${to}/${total}`);
        }

        journal.service('range', `${req.params.kind} ${from}-${to} of ${total}`);

        try {
            await pourAcross(res, track, from, to);
            res.end();
        } catch (error) {
            journal.service('range', `${req.params.kind} ${from}-${to} broke: ${error.message}`);
            res.destroy();
        }

        return undefined;
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

function send(session, kind, number, res) {
    const track = session.tracks[kind];
    if (!track) return res.status(404).end();
    if (!stream.locate(track, number)) return res.status(404).end();

    // Asking for a segment is what moves the download's window along, for both tracks: the
    // player asks about one at a time and they share a position.
    track.want(number);
    if (number > 0) stream.align(session, kind, number);

    const asked = Date.now();

    return track.reach(number).then(
        () => {
            const at = stream.locate(track, number);

            // Every fragment the set asks for, and how long it waited. This is the only
            // view there is of the read pattern — what the player asks for, how far ahead
            // of the playhead, and where it stops asking — and without it a stall can only
            // be guessed at from the download side, which goes on looking healthy.
            journal.service('segment', `${kind} ${number} in ${Date.now() - asked}ms`);

            const length = at.end - at.start + 1;

            res.setHeader('Content-Type', typeOf(track.format.mimeType));
            res.setHeader('Content-Length', length);
            res.setHeader('Accept-Ranges', 'none');

            // What was promised against what was sent. A fragment served short is invisible
            // from both ends: the header says one thing, the socket carries another, and the
            // set neither errors nor asks again — it simply stops, which is the failure
            // being chased. A stream restarted mid-file is where this would go wrong, so it
            // is counted rather than assumed.
            let sent = 0;
            const out = track.pour(number);

            out.on('data', (chunk) => { sent += chunk.length; });

            out.on('error', (error) => {
                journal.service('segment', `${kind} ${number} broke after ${sent} of `
                    + `${length} bytes: ${error.message}`);
                res.destroy();
            });

            // Always, not only when the counts disagree. A response that never finishes
            // sending is the one shape that leaves no trace at either end — the set is still
            // loading, the service is still holding the socket, and nothing anywhere says
            // so. An unremarkable line for a completed send is what makes its absence mean
            // something.
            out.on('end', () => {
                journal.service('segment', `${kind} ${number} sent ${sent} of ${length} bytes`
                    + ` in ${Date.now() - asked}ms`);
            });

            out.pipe(res);
        },
        (error) => {
            journal.service('segment', `${kind} ${number} refused: ${error.message}`);
            if (!res.headersSent) res.status(503).end();
        }
    );
}

module.exports = { attach, describe, manifest, send };
