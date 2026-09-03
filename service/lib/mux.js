'use strict';

// Two fragmented MP4 streams joined into one, so the picture and the sound can be served
// from a single address with no manifest at all.
//
// DASH and HLS both describe a stream and let the set fetch the pieces; each has its own
// parser, its own read-ahead and its own idea of when to present a frame, and on this
// hardware those two descriptions of identical media play visibly differently. A plain file
// has none of that machinery — the set is handed bytes and plays them.
//
// YouTube serves the two tracks separately and both call themselves track 1, so the sound
// has to be renumbered before the two can share a file. Every rewrite here replaces a
// four-byte field with another four bytes: nothing moves, so the sample offsets inside each
// fragment — which are counted from the start of their own `moof` — stay correct.
//
// That property is what makes the file seekable. A fragment on disk is exactly as long as
// the segment index said it would be, so the whole file's length and the offset of
// everything in it are known as soon as the two indexes have been read — before a byte of
// media has been fetched. A range request can therefore be answered exactly, and a `sidx`
// written into the head lets the set ask for a moment rather than guess at a byte.

const { boxes } = require('./mp4.js');

const VIDEO_TRACK = 1;
const AUDIO_TRACK = 2;

// Milliseconds, so the durations in the index go in as they are.
const TIMESCALE = 1000;

/** The children of a box, walked from its body. */
const childrenOf = (buffer, box) => boxes(buffer.subarray(box.body, box.end))
    .map((child) => ({
        type: child.type,
        start: box.body + child.start,
        end: box.body + child.end,
        body: box.body + child.body
    }));

/** The first box of a type among some boxes. */
const named = (list, type) => list.filter((box) => box.type === type)[0] || null;

/** A box as its own buffer, copied so the original is never written through. */
const slice = (buffer, box) => Buffer.from(buffer.subarray(box.start, box.end));

/**
 * Where a `tkhd` keeps its track id.
 *
 * Version 1 widens the two times to sixty-four bits, and the id sits after them either way.
 */
const trackIdIn = (buffer, tkhd) => tkhd.body + 4 + (buffer.readUInt8(tkhd.body) === 1 ? 16 : 8);

/**
 * A `trak`, renumbered and told how long it runs. The box keeps its size, so nothing after
 * it moves.
 *
 * The duration is in the movie's timescale, which is where a `tkhd` states it — the track's
 * own `mdhd` uses the media timescale and is left alone.
 */
function retrak(buffer, trak, id, ticks) {
    const copy = slice(buffer, trak);
    const inside = boxes(copy.subarray(8)).map((box) => ({
        type: box.type, start: 8 + box.start, end: 8 + box.end, body: 8 + box.body
    }));

    const tkhd = named(inside, 'tkhd');
    if (!tkhd) return copy;

    copy.writeUInt32BE(id, trackIdIn(copy, tkhd));

    // Only the narrow form is written by anything YouTube serves, and the wide one keeps
    // the duration somewhere this would have to guess at.
    if (ticks && copy.readUInt8(tkhd.body) === 0) copy.writeUInt32BE(ticks, tkhd.body + 20);

    return copy;
}

/** A `trex`, renumbered, which is what tells the set the track exists in fragments. */
function retrex(buffer, trex, id) {
    const copy = slice(buffer, trex);
    copy.writeUInt32BE(id, 8 + 4);
    return copy;
}

/** A box header for a body that is already assembled. */
function wrap(type, body) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(body.length + 8, 0);
    header.write(type, 4, 'latin1');
    return Buffer.concat([header, body]);
}

/** The movie timescale, and where the header keeps its own duration. */
function timing(buffer, mvhd) {
    const wide = buffer.readUInt8(mvhd.body) === 1;

    return {
        timescale: buffer.readUInt32BE(mvhd.body + (wide ? 20 : 12)),
        durationAt: mvhd.body + (wide ? 24 : 16),
        wide
    };
}

/**
 * How long the movie runs, said where a fragmented file says it.
 *
 * Without this the element never learns a duration: it reports `NaN`, offers nothing as
 * seekable, and answers a seek by guessing a byte offset from a length it does not know.
 * Asked for thirty seconds of a fifty-two second video it fetched eighty per cent of the
 * file and landed at forty-one.
 */
const movieExtendsHeader = (ticks) => {
    const body = Buffer.alloc(8);
    body.writeUInt32BE(0, 0);            // version 0, no flags
    body.writeUInt32BE(ticks, 4);
    return wrap('mehd', body);
};

/**
 * The `moov` describing both tracks.
 *
 * The picture's own is the frame this is built on — its `mvhd` sets the timescale
 * everything else is read against — and the sound's `trak` is lifted into it as track two.
 */
function movie(videoInit, audioInit, durationMs) {
    const video = named(boxes(videoInit), 'moov');
    const audio = named(boxes(audioInit), 'moov');
    if (!video || !audio) return null;

    const videoParts = childrenOf(videoInit, video);
    const audioParts = childrenOf(audioInit, audio);

    const mvhd = named(videoParts, 'mvhd');
    const videoTrak = named(videoParts, 'trak');
    const audioTrak = named(audioParts, 'trak');
    if (!mvhd || !videoTrak || !audioTrak) return null;

    const header = slice(videoInit, mvhd);
    const clock = timing(videoInit, mvhd);
    const ticks = Math.round((durationMs || 0) * (clock.timescale || 1000) / 1000);

    // So a set that walks the file to work out what tracks to expect is told there are two
    // and no more. Only the thirty-two-bit form is written by anything YouTube serves.
    if (!clock.wide) {
        header.writeUInt32BE(AUDIO_TRACK + 1, 8 + 96);
        if (ticks) header.writeUInt32BE(ticks, 8 + (clock.durationAt - mvhd.body));
    }

    const videoTrex = named(childrenOf(videoInit, named(videoParts, 'mvex') || video), 'trex');
    const audioTrex = named(childrenOf(audioInit, named(audioParts, 'mvex') || audio), 'trex');

    const mvex = videoTrex && audioTrex
        ? wrap('mvex', Buffer.concat([
            ticks ? movieExtendsHeader(ticks) : Buffer.alloc(0),
            retrex(videoInit, videoTrex, VIDEO_TRACK),
            retrex(audioInit, audioTrex, AUDIO_TRACK)
        ]))
        : Buffer.alloc(0);

    return wrap('moov', Buffer.concat([
        header,
        retrak(videoInit, videoTrak, VIDEO_TRACK, ticks),
        retrak(audioInit, audioTrak, AUDIO_TRACK, ticks),
        mvex
    ]));
}

/**
 * How the fragments are grouped in the file: each picture segment preceded by the sound
 * that belongs with it.
 *
 * Grouped rather than merely interleaved, because a `sidx` describes runs of bytes against
 * durations — so each group has to be one contiguous stretch covering one span of time, and
 * a set given a moment can land on the group holding it.
 */
function group(videoIndex, audioIndex) {
    const groups = [];
    let audioAt = 0;

    videoIndex.forEach((video) => {
        const parts = [];
        const until = video.startMs + video.durationMs;

        while (audioAt < audioIndex.length && audioIndex[audioAt].startMs < until) {
            const audio = audioIndex[audioAt];
            parts.push({
                kind: 'audio',
                number: audio.number,
                size: audio.end - audio.start + 1,
                startMs: audio.startMs
            });
            audioAt += 1;
        }

        parts.push({
            kind: 'video',
            number: video.number,
            size: video.end - video.start + 1,
            startMs: video.startMs
        });

        // In the order the moments happen, not sound first.
        //
        // The sound was put in front of the picture it belongs with, so that a reader that
        // had got this far had both. But an audio fragment is longer than a video one here
        // — ten seconds against six — so one that merely *starts* inside a video segment's
        // span can cover the whole of the next one. Where it starts near that span's end
        // the reader is handed sound for ten seconds it has no picture for yet.
        //
        // Measured on the television, on the video that shows this most plainly: audio
        // beginning at 39.94 was written in front of the picture covering 34.03 to 40.04 —
        // a tenth of a second before that picture ends, the largest such jump in the file —
        // and a viewer saw a hiccup at exactly 34. Ordered by time it reads as it plays.
        // Sound still goes first where the two begin together, which is where it is wanted.
        parts.sort((a, b) => (a.startMs - b.startMs) || (a.kind === 'audio' ? -1 : 1));

        groups.push({ parts, startMs: video.startMs, durationMs: video.durationMs });
    });

    // Sound that outlasts the last picture belongs to the last group; a group of its own
    // would claim a span of time the file does not have.
    if (groups.length) {
        while (audioAt < audioIndex.length) {
            const audio = audioIndex[audioAt];
            groups[groups.length - 1].parts.push({
                kind: 'audio',
                number: audio.number,
                size: audio.end - audio.start + 1,
                startMs: audio.startMs
            });
            audioAt += 1;
        }
    }

    return groups;
}

/** The segment index for the groups, so a seek can name a moment instead of a byte. */
function segmentIndexFor(groups) {
    const body = Buffer.alloc(24 + (12 * groups.length));
    let at = 0;

    body.writeUInt32BE(0, at); at += 4;                  // version 0, no flags
    body.writeUInt32BE(VIDEO_TRACK, at); at += 4;        // reference id
    body.writeUInt32BE(TIMESCALE, at); at += 4;
    body.writeUInt32BE(groups.length ? groups[0].startMs : 0, at); at += 4;
    body.writeUInt32BE(0, at); at += 4;                  // the first group follows this box
    body.writeUInt16BE(0, at); at += 2;                  // reserved
    body.writeUInt16BE(groups.length, at); at += 2;

    groups.forEach((one) => {
        const size = one.parts.reduce((total, part) => total + part.size, 0);

        // Top bit clear: this reference is media, not another index.
        body.writeUInt32BE(size & 0x7fffffff, at); at += 4;
        body.writeUInt32BE(one.durationMs, at); at += 4;

        // Starts with a stream access point of type 1, which every fragment here does.
        body.writeUInt32BE(0x90000000, at); at += 4;
    });

    return wrap('sidx', body);
}

/**
 * Everything about the file that can be known before it is fetched: the bytes of its head,
 * and where every fragment will land.
 *
 * Returned together because the offsets depend on the head's length and the head's length
 * depends on how many groups there are, so working either out alone is half an answer.
 */
function describeFile(videoInit, audioInit, videoIndex, audioIndex) {
    // As long as both tracks have something to show, which is what the element can play.
    const spanOf = (index) => (index.length
        ? index[index.length - 1].startMs + index[index.length - 1].durationMs
        : 0);

    const durationMs = Math.min(spanOf(videoIndex), spanOf(audioIndex));

    const moov = movie(videoInit, audioInit, durationMs);
    if (!moov) return null;

    const ftyp = named(boxes(videoInit), 'ftyp');
    const groups = group(videoIndex, audioIndex);
    const index = segmentIndexFor(groups);

    const head = Buffer.concat([
        ftyp ? slice(videoInit, ftyp) : Buffer.alloc(0),
        moov,
        index
    ]);

    // Laid out in the order they will be written, so a range request can be answered by
    // walking this rather than by fetching anything.
    const parts = [];
    let offset = head.length;

    groups.forEach((one) => one.parts.forEach((part) => {
        parts.push(Object.assign({ offset }, part));
        offset += part.size;
    }));

    return { head, parts, groups, total: offset, durationMs };
}

/**
 * A media fragment, renumbered onto a track and given its place in the sequence.
 *
 * Both fields are four bytes wide and are written where they stand, so the sample offsets a
 * `trun` holds — counted from the start of this `moof` — go on pointing at the same bytes,
 * and the fragment is exactly as long as the index promised.
 */
function retrack(fragment, id, sequence) {
    const copy = Buffer.from(fragment);
    const top = boxes(copy);

    const moof = named(top, 'moof');
    if (!moof) return copy;

    const inside = childrenOf(copy, moof);

    const mfhd = named(inside, 'mfhd');
    if (mfhd && typeof sequence === 'number') copy.writeUInt32BE(sequence, mfhd.body + 4);

    inside.filter((box) => box.type === 'traf').forEach((traf) => {
        const tfhd = named(childrenOf(copy, traf), 'tfhd');
        if (tfhd) copy.writeUInt32BE(id, tfhd.body + 4);
    });

    return copy;
}

/** The byte range a request asks for, or null when it asks for the whole file. */
function rangeOf(header, total) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
    if (!match) return null;

    const hasFirst = match[1] !== '';
    const hasLast = match[2] !== '';
    if (!hasFirst && !hasLast) return null;

    // "-500" means the last five hundred bytes.
    const from = hasFirst ? Number(match[1]) : Math.max(0, total - Number(match[2]));
    const to = hasFirst && hasLast ? Math.min(Number(match[2]), total - 1) : total - 1;

    if (from > to || from >= total) return { unsatisfiable: true };

    // Whether the caller named an end. One that did not is asking for "the rest", which is
    // a request to be answered with a sensible amount rather than with everything.
    return { from, to, open: !hasLast };
}

module.exports = {
    describeFile, retrack, rangeOf, group, segmentIndexFor,
    VIDEO_TRACK, AUDIO_TRACK, TIMESCALE
};
