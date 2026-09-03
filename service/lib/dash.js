'use strict';

const express = require('express');
const { createReadStream } = require('fs');
const { open, readFile } = require('fs/promises');

const hls = require('./hls.js');
const mux = require('./mux.js');
const journal = require('./journal.js');
const sabr = require('./sabr.js');
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

function describe(session) {
    const track = ({ kind, format, index }) => ({
        kind,
        itag: format.itag,
        // Dubbed tracks and compressed dynamic range share an itag, so it does not name a format
        // on its own.
        xtags: format.xtags || '',
        codecs: codecsOf(format.mimeType),
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

    app.get('/dash/by-video/:videoId/master.m3u8', (req, res) => {
        stream.awaitVideo(req.params.videoId).then(
            (session) => res.redirect(302, `/dash/${session.id}/master.m3u8`),
            (error) => res.status(404).send(error.message)
        );
    });

    app.get('/dash/by-video/:videoId/manifest.mpd', (req, res) => {
        stream.awaitVideo(req.params.videoId).then(
            (session) => res.redirect(302, `/dash/${session.id}/manifest.mpd`),
            // Not found rather than timed out, which the page reads as "no stream here" and answers
            // by dropping back to its own player.
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

        // A session exists from the moment it is asked for; its manifest cannot be written until
        // both indexes have been read.
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
            await readFile(video.file(0)),
            await readFile(audio.file(0)),
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
    async function pourFragment(res, file, id, sequence, begin, finish) {
        const handle = await open(file, 'r');
        let headLength = 0;

        try {
            const header = Buffer.alloc(8);
            await handle.read(header, 0, 8, 0);

            // Anything else is not a fragment this wrote, so the bytes go out untouched.
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
                await pourFragment(res, track.file(part.number), id, at + 1, begin, finish);
            } catch (error) {
                return res.end();
            }

            return send(at + 1);
        };

        return send(0);
    });

    // One track as a plain file, for a browser that plays fragmented MP4 from a URL but has
    // no DASH of its own. This is what makes the page testable off the television.
    app.get('/dash/:id/:kind.mp4', (req, res) => {
        const session = find(req, res);
        if (!session) return;

        const track = session.tracks[req.params.kind];
        if (!track || !track.index) return res.status(404).end();

        res.setHeader('Content-Type', typeOf(track.format.mimeType));
        res.setHeader('Accept-Ranges', 'none');

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

function send(session, kind, number, res) {
    const track = session.tracks[kind];
    if (!track) return res.status(404).end();
    if (!stream.locate(track, number)) return res.status(404).end();

    // Asking for a segment is what moves the download's window along, for both tracks: the
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
