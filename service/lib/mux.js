'use strict';

// Every rewrite replaces four bytes with four: nothing may move, or sample offsets and the
// precomputed file layout break.

const { boxes } = require('./mp4.js');

const VIDEO_TRACK = 1;
const AUDIO_TRACK = 2;

const TIMESCALE = 1000;

const childrenOf = (buffer, box) => boxes(buffer.subarray(box.body, box.end))
    .map((child) => ({
        type: child.type,
        start: box.body + child.start,
        end: box.body + child.end,
        body: box.body + child.body
    }));

const named = (list, type) => list.filter((box) => box.type === type)[0] || null;

const slice = (buffer, box) => Buffer.from(buffer.subarray(box.start, box.end));

// tkhd v1 widens the two times to 64 bits; the track id follows them either way.
const trackIdIn = (buffer, tkhd) => tkhd.body + 4 + (buffer.readUInt8(tkhd.body) === 1 ? 16 : 8);

function retrak(buffer, trak, id, ticks) {
    const copy = slice(buffer, trak);
    const inside = boxes(copy.subarray(8)).map((box) => ({
        type: box.type, start: 8 + box.start, end: 8 + box.end, body: 8 + box.body
    }));

    const tkhd = named(inside, 'tkhd');
    if (!tkhd) return copy;

    copy.writeUInt32BE(id, trackIdIn(copy, tkhd));

    if (ticks && copy.readUInt8(tkhd.body) === 0) copy.writeUInt32BE(ticks, tkhd.body + 20);

    return copy;
}

function retrex(buffer, trex, id) {
    const copy = slice(buffer, trex);
    copy.writeUInt32BE(id, 8 + 4);
    return copy;
}

function wrap(type, body) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(body.length + 8, 0);
    header.write(type, 4, 'latin1');
    return Buffer.concat([header, body]);
}

function timing(buffer, mvhd) {
    const wide = buffer.readUInt8(mvhd.body) === 1;

    return {
        timescale: buffer.readUInt32BE(mvhd.body + (wide ? 20 : 12)),
        durationAt: mvhd.body + (wide ? 24 : 16),
        wide
    };
}

// Without `mehd` the element reports a NaN duration, offers nothing as seekable, and guesses
// byte offsets on a seek.
const movieExtendsHeader = (ticks) => {
    const body = Buffer.alloc(8);
    body.writeUInt32BE(0, 0);            // version 0, no flags
    body.writeUInt32BE(ticks, 4);
    return wrap('mehd', body);
};

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

        // Ordered by when each part starts, not audio first: an audio fragment can begin late in
        // a video segment's span, and writing it ahead of that segment is heard as a hiccup.
        parts.sort((a, b) => (a.startMs - b.startMs) || (a.kind === 'audio' ? -1 : 1));

        groups.push({ parts, startMs: video.startMs, durationMs: video.durationMs });
    });

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

function segmentIndexFor(groups) {
    const body = Buffer.alloc(24 + (12 * groups.length));
    let at = 0;

    body.writeUInt32BE(0, at); at += 4;                  // version 0, no flags
    body.writeUInt32BE(VIDEO_TRACK, at); at += 4;
    body.writeUInt32BE(TIMESCALE, at); at += 4;
    body.writeUInt32BE(groups.length ? groups[0].startMs : 0, at); at += 4;
    body.writeUInt32BE(0, at); at += 4;
    body.writeUInt16BE(0, at); at += 2;
    body.writeUInt16BE(groups.length, at); at += 2;

    groups.forEach((one) => {
        const size = one.parts.reduce((total, part) => total + part.size, 0);

        // Top bit clear: this reference is media, not another index.
        body.writeUInt32BE(size & 0x7fffffff, at); at += 4;
        body.writeUInt32BE(one.durationMs, at); at += 4;

        // Starts with a SAP of type 1, which every fragment here does.
        body.writeUInt32BE(0x90000000, at); at += 4;
    });

    return wrap('sidx', body);
}

function describeFile(videoInit, audioInit, videoIndex, audioIndex) {
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

    const parts = [];
    let offset = head.length;

    groups.forEach((one) => one.parts.forEach((part) => {
        parts.push(Object.assign({ offset }, part));
        offset += part.size;
    }));

    return { head, parts, groups, total: offset, durationMs };
}

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

    return { from, to, open: !hasLast };
}

module.exports = {
    describeFile, retrack, rangeOf, group, segmentIndexFor,
    VIDEO_TRACK, AUDIO_TRACK, TIMESCALE
};
