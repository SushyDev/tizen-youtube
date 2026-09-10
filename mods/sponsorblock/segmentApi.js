import { sha256 } from '../../framework/index.js';

// Asking SponsorBlock what is in a video.
//
// The request carries the first four characters of a hash of the video id, never the id itself, so
// the server learns only that someone is watching one of the several thousand videos sharing that
// prefix. The answer is every video in the prefix, and the one that matters is picked out here.

const API = 'https://sponsor.ajay.app/api';

// poi_highlight is asked for but never skipped: it marks a point, it does not cover a stretch.
// It is what the "Skip to highlight" button is drawn from.
const ASKED_FOR = [
    'sponsor', 'intro', 'outro', 'interaction',
    'selfpromo', 'preview', 'filler', 'music_offtopic', 'poi_highlight'
];

const segmentsFor = async (videoID) => {
    const videoHash = sha256(videoID).substring(0, 4);
    const asked = encodeURIComponent(JSON.stringify(ASKED_FOR));

    const response = await fetch(`${API}/skipSegments/${videoHash}?categories=${asked}`);
    const results = await response.json();

    const result = results.find((entry) => entry.videoID === videoID);

    return (result && result.segments) || [];
};

export { segmentsFor };
