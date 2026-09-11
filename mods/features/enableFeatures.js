import { configRead, configChangeEmitter } from '../config.js';
import { findMap } from '../youtube/internals.js';
import { waitFor } from '../utils/waitFor.js';

const PREVIEWS = 'ENABLE_PREVIEWS_WITH_SOUND';

configChangeEmitter.addEventListener('configChange', (event) => event.detail.key === 'enablePreviews' && enableFeatures());

function enableFeatures() {
    waitFor(() => findMap(PREVIEWS), (flags) => flags.set(PREVIEWS, configRead('enablePreviews')));
}

if (document.readyState === 'complete') {
    enableFeatures();
} else window.addEventListener('load', enableFeatures);