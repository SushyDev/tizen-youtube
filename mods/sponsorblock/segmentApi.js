import { sha256 } from '../../framework/index.js';

// Asks by a 4-character hash prefix, so the server never learns the video id.

const API = 'https://sponsor.ajay.app/api';

// poi_highlight marks a point rather than a stretch, so it is never skipped and only feeds the highlight button.
const ASKED_FOR = [
    'sponsor', 'intro', 'outro', 'interaction', 'selfpromo',
    'preview', 'filler', 'music_offtopic', 'exclusive_access', 'poi_highlight'
];

// Other actions exist (mute, chapter, full-video warning) but aren't handled yet, so only skip and point are kept.
// A missing actionType defaults to skip, matching the API's own default.
const KEPT_ACTION_TYPES = ['skip', 'poi'];

const segmentsFor = async (videoID) => {
    const videoHash = sha256(videoID).substring(0, 4);
    const asked = encodeURIComponent(JSON.stringify(ASKED_FOR));

    const response = await fetch(`${API}/skipSegments/${videoHash}?categories=${asked}`);
    const results = await response.json();

    const result = results.find((entry) => entry.videoID === videoID);
    const segments = (result && result.segments) || [];

    return segments.filter((segment) => KEPT_ACTION_TYPES.indexOf(segment.actionType || 'skip') !== -1);
};

export { segmentsFor };
