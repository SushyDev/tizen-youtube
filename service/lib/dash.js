'use strict';

const express = require('express');

const mux = require('./mux.js');
const journal = require('./journal.js');
const stream = require('./stream.js');

// Without these the set never switches the panel into HDR.
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

// `r` counts additional repeats. Extend a run only while the durations still sum to the
// segment's real start: a seek is mapped by counting them forward, and drift serves the wrong one.
function timelineOf(index) {
    const runs = [];
    let counted = null;
    let drift = 0;

    index.forEach((segment) => {
        const last = runs[runs.length - 1];

        // Ticks, not milliseconds: a fragment's decode times are in these units, and a timeline in
        // rounded milliseconds cannot be lined up with them at a seek.
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

// SegmentBase/indexRange requires the on-demand profile; live is for numbered segments.
function profileFor(session) {
    const byIndex = Object.values(session.tracks).every((track) => track.cues && track.setup);

    return byIndex
        ? 'urn:mpeg:dash:profile:isoff-on-demand:2011'
        : 'urn:mpeg:dash:profile:isoff-live:2011';
}

function manifest(session) {
    const set = (track, attributes, extra) => {
        const format = track.format;

        // WebM clusters are not addressable as numbered segments; YouTube describes WebM as one
        // file with an indexRange over the cues, which is what the set's DASH reader expects.
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
        xtags: format.xtags || '',
        codecs: codecsOf(format.mimeType),

        container: /^(video|audio)\/mp4/.test(format.mimeType || '') ? 'mp4' : 'webm',
        colour: colourOf(format),
        bitrate: format.bitrate || 0,
        width: format.width,
        height: format.height,
        fps: format.fps,
        mimeType: typeOf(format.mimeType),
        segments: index.length,

        first: index[0].number,
        durationsMs: index.map((segment) => segment.durationMs)
    });

    return {
        id: session.id,
        videoId: session.videoId,
        durationMs: session.durationMs,
        video: track(session.tracks.video),
        audio: track(session.tracks.audio),

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

    // Never redirect a progressive URL to a manifest: the set commits to reading an MP4 from the
    // address it was given.
    app.get('/dash/by-video/:videoId/progressive.mp4', (req, res) => {
        stream.awaitVideo(req.params.videoId).then(
            (session) => res.redirect(302, `/dash/${session.id}/progressive.mp4`),
            (error) => res.status(404).send(error.message)
        );
    });

    app.get('/dash/by-video/:videoId/manifest.mpd', (req, res) => {
        stream.awaitVideo(req.params.videoId).then(
            (session) => {
                // `?at=` not `#t=`: the browser strips a media fragment before the request.
                const at = Math.floor(Number(req.query && req.query.at) || 0);

                if (at > 0) {
                    journal.service('seek', `${session.id} asked to open at ${at}s`);
                    stream.beginAt(session, at * 1000);
                }

                res.redirect(302, `/dash/${session.id}/manifest.mpd`);
            },
            // 404, not a timeout: the page reads it as "no stream" and falls back to its own player.
            (error) => res.status(404).send(error.message)
        );
    });

    const find = (req, res) => {
        const session = stream.sessions.get(req.params.id);

        // A session that goes while the element is still attached ends the video silently: no
        // error, no event, the picture just stops.
        if (!session) {
            journal.service('segment', `${req.params.id} is gone; refusing ${req.path}`);
            res.status(404).send('no such session');
        } else {
            session.read = Date.now();
        }

        return session || null;
    };

    app.get('/dash/:id/alive', (req, res) => {
        const session = find(req, res);
        if (!session) return;

        res.json({ ok: true });
    });

    app.get('/dash/:id/manifest.mpd', (req, res) => {
        const session = find(req, res);
        if (!session) return;

        if (!session.ready) return res.status(503).send('the stream is still opening');

        res.setHeader('Content-Type', 'application/dash+xml');
        res.send(manifest(session));
    });

    // Past this the set fetches the first chunk and then consumes nothing, reporting no error
    // (bisected: 553MB plays, 684MB does not). `PLAIN_FILE_LIMIT` in the userscript must match.
    const MAX_FILE = 600 * 1024 * 1024;

    const described = new Map();

    // A seek opens several of these at once; only the newest is served, or they abort one
    // another's downloads.
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

    // Only the `moof` is rewritten and the `mdat` streamed: buffering a whole 2160p60 fragment to
    // change eight bytes costs ~30MB twice over.
    async function pourFragment(res, track, number, id, sequence, begin, finish) {
        const header = await track.head(number, 8);
        let headLength = 0;

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

    track.want(number);
    if (number > 0) stream.align(session, kind, number);

    const asked = Date.now();

    return track.reach(number).then(
        () => {
            const at = stream.locate(track, number);

            journal.service('segment', `${kind} ${number} in ${Date.now() - asked}ms`);

            const length = at.end - at.start + 1;

            res.setHeader('Content-Type', typeOf(track.format.mimeType));
            res.setHeader('Content-Length', length);
            res.setHeader('Accept-Ranges', 'none');

            let sent = 0;
            const out = track.pour(number);

            out.on('data', (chunk) => { sent += chunk.length; });

            out.on('error', (error) => {
                journal.service('segment', `${kind} ${number} broke after ${sent} of `
                    + `${length} bytes: ${error.message}`);
                res.destroy();
            });

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
