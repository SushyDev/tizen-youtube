import { configChangeEmitter, configRead, findMap, whenFound } from '../../framework/index.js';

const PREVIEWS = 'ENABLE_PREVIEWS_WITH_SOUND';

// Started a fresh poll on every config write, whatever the key, so changing an unrelated setting
// left another one running.
configChangeEmitter.addEventListener('configChange', (event) => {
    if (event.detail?.key !== 'enablePreviews') return;
    enableFeatures();
});

function enableFeatures() {
    whenFound('preview flag', () => findMap(PREVIEWS), (flags) => flags.set(PREVIEWS, configRead('enablePreviews')));
}

if (document.readyState === 'complete') {
    enableFeatures();
} else window.addEventListener('load', enableFeatures);
