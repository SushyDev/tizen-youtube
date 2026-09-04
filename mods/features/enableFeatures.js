import { configRead, configChangeEmitter } from '../config.js';

configChangeEmitter.addEventListener('configChange', (event) => {
    enableFeatures();
});

function enableFeatures() {
    if (!window._yttv) return setTimeout(enableFeatures, 250);
    const yttvValues = Object.values(window._yttv);

    yttvValues.find(a => a instanceof Map && a.has("ENABLE_PREVIEWS_WITH_SOUND"))?.set("ENABLE_PREVIEWS_WITH_SOUND", configRead('enablePreviews'));
}

if (document.readyState === 'complete') {
    enableFeatures();
} else window.addEventListener('load', enableFeatures);