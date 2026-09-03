'use strict';

// The same stream, described as HLS instead of DASH.
//
// Both are handed to the element as a plain URL, and both are played by the platform's own
// pipeline rather than through MediaSource — which is the whole point of serving anything
// here. What differs is the description, and on a Samsung set HLS is the better-trodden
// path: it is what broadcast apps ship, so it is the one the platform's own people
// exercise. Whether it starts faster or seeks better than DASH on this hardware is a
// question only the television can answer, so it is offered beside DASH rather than
// instead of it.
//
// The segments are the ones already on disk. HLS carries fragmented MP4 the same way DASH
// does — an initialisation segment named by EXT-X-MAP and media segments after it — so
// nothing is cut twice and the two descriptions point at the same files.

const codecsOf = (mimeType) => {
    const match = /codecs="([^"]+)"/.exec(mimeType || '');
    return match ? match[1] : '';
};

// How HLS says what the pictures' brightness means. DASH states this as CICP code points;
// HLS has three words for it, and saying the wrong one is worse than saying nothing —
// a set told SDR will tone-map a PQ picture into a flat grey.
function rangeOf(format) {
    const colour = format.colorInfo || {};

    if (colour.transferCharacteristics === 'COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084') return 'PQ';
    if (colour.transferCharacteristics === 'COLOR_TRANSFER_CHARACTERISTICS_ARIB_STD_B67') return 'HLG';

    return 'SDR';
}

/** The longest segment, rounded up, which is what EXT-X-TARGETDURATION has to be. */
const targetDuration = (index) => Math.ceil(index.reduce(
    (longest, segment) => Math.max(longest, segment.durationMs), 0
) / 1000);

/**
 * One track's playlist: every segment, in order, at the addresses they are already served
 * from.
 *
 * A VOD playlist is written once and complete — the file's own index says how long each
 * segment runs, so none of this depends on how much has been downloaded.
 */
function media(session, kind) {
    const track = session.tracks[kind];
    if (!track || !track.index) return null;

    const lines = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        `#EXT-X-TARGETDURATION:${targetDuration(track.index)}`,
        `#EXT-X-MEDIA-SEQUENCE:${track.index[0].number}`,
        `#EXT-X-MAP:URI="${kind}/init.mp4"`
    ];

    track.index.forEach((segment) => {
        lines.push(`#EXTINF:${(segment.durationMs / 1000).toFixed(3)},`);
        lines.push(`${kind}/${segment.number}.m4s`);
    });

    lines.push('#EXT-X-ENDLIST');

    return `${lines.join('\n')}\n`;
}

/**
 * The playlist that names the others.
 *
 * One variant, because there is one of each track — the same single-rung commitment DASH
 * makes here. The sound is a separate media playlist rather than muxed in, which is what
 * lets the two be fetched independently the way the DASH tracks are.
 */
function master(session) {
    const video = session.tracks.video;
    const audio = session.tracks.audio;
    if (!video || !audio) return null;

    const bandwidth = (video.format.bitrate || 0) + (audio.format.bitrate || 0);
    const codecs = [codecsOf(video.format.mimeType), codecsOf(audio.format.mimeType)]
        .filter(Boolean).join(',');

    const stream = [
        `BANDWIDTH=${bandwidth}`,
        `AVERAGE-BANDWIDTH=${bandwidth}`,
        `CODECS="${codecs}"`,
        `RESOLUTION=${video.format.width}x${video.format.height}`,
        `FRAME-RATE=${(video.format.fps || 30).toFixed(3)}`,
        `VIDEO-RANGE=${rangeOf(video.format)}`,
        'AUDIO="audio"'
    ].join(',');

    return [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-INDEPENDENT-SEGMENTS',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"',
        `#EXT-X-STREAM-INF:${stream}`,
        'video.m3u8',
        ''
    ].join('\n');
}

module.exports = { master, media, rangeOf };
