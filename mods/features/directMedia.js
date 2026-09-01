import { configRead, configChangeEmitter } from '../config.js';

// Asks the service to stop proxying the media so the player pulls it from googlevideo
// itself. Only means anything on the proxy path, where every segment otherwise goes
// through Node on the television. Whether googlevideo will answer a localhost page is
// the reason it was proxied to begin with, so if the picture stops, turn it back off.

// The service serves the page over plain HTTP on loopback; anywhere else is youtube.com
// itself, where there is nothing to ask.
const servedByService = () => /^http:\/\/localhost:\d+$/.test(window.location.origin);

function apply(direct) {
    if (!servedByService()) return;

    // Same origin, so a relative path reaches the service that served this page.
    fetch(`/__tube/media?mode=${direct ? 'direct' : 'proxy'}`)
        .then((response) => response.json())
        .then((state) => {
            console.log(`[tube] media is served ${state.proxied ? 'through the service' : 'direct from googlevideo'}.`);
        })
        .catch((error) => {
            // A service that will not answer is not a reason to stop playing.
            console.warn('[tube] could not set where media comes from.', error);
        });
}

apply(configRead('directMediaPlayback'));

configChangeEmitter.addEventListener('configChange', (event) => {
    if (event.detail.key !== 'directMediaPlayback') return;
    apply(event.detail.value);
});
