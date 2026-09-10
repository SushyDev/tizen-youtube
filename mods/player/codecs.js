import { configRead, onResponse } from '../../framework/index.js';

// Which codec the player is offered. Dropping the others from the format list is how a preference
// is expressed to a client that has no setting for it — and only when the wanted one is actually
// on offer, or the video would have nothing left to play.

onResponse('preferred codec', ['streamingData'], (r) => {
    const formats = r?.streamingData?.adaptiveFormats;
    const wanted = configRead('videoPreferredCodec');

    if (!formats || wanted === 'any') return;
    if (!formats.find((format) => format.mimeType.includes(wanted))) return;

    r.streamingData.adaptiveFormats = formats.filter((format) =>
        format.mimeType.startsWith('audio/') || format.mimeType.includes(wanted));
});
