'use strict';

// Serves YouTube's media back to the page as DASH on localhost, because a video element
// fed a URL plays 2160p60 here without dropping frames and the same media through
// MediaSource does not. The manifest covers the whole video from the first moment; a
// segment the player reaches before the download does is waited for, not refused.

const express = require('express');
const { createReadStream } = require('fs');

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

/** What the response says about a format's colour, in words the page can show. */
function colourOf(format) {
    const colour = format.colorInfo || {};
    if (!colour.primaries && !colour.transferCharacteristics) return null;

    const name = (value) => String(value || '')
        .replace('COLOR_PRIMARIES_', '')
        .replace('COLOR_TRANSFER_CHARACTERISTICS_', '')
        .toLowerCase();

    return { primaries: name(colour.primaries), transfer: name(colour.transferCharacteristics) };
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
        segments: index.length
    });

    return {
        id: session.id,
        videoId: session.videoId,
        durationMs: session.durationMs,
        video: track(session.tracks.video),
        audio: track(session.tracks.audio)
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
    // asking for a segment is what moves the window along.
    track.want(number);

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
