'use strict';

const codecsOf = (mimeType) => {
    const match = /codecs="([^"]+)"/.exec(mimeType || '');
    return match ? match[1] : '';
};

// Saying the wrong one is worse than saying nothing: a set told SDR will tone-map a PQ
// picture into a flat grey.
function rangeOf(format) {
    const colour = format.colorInfo || {};

    if (colour.transferCharacteristics === 'COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084') return 'PQ';
    if (colour.transferCharacteristics === 'COLOR_TRANSFER_CHARACTERISTICS_ARIB_STD_B67') return 'HLG';

    return 'SDR';
}

// The longest segment, rounded up, which is what EXT-X-TARGETDURATION has to be.
const targetDuration = (index) => Math.ceil(index.reduce(
    (longest, segment) => Math.max(longest, segment.durationMs), 0
) / 1000);

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
