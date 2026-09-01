import { configRead, configChangeEmitter } from '../config.js';

// Where the video bytes come from, on the path where there is a choice.
//
// With Developer Mode unavailable the app falls back to proxying youtube.com through its
// own service, and that proxy carries the media too: every segment of a 4K60 stream is
// piped through Node on the television's own chip, which is also the chip decoding it.
// Asking the service to leave the media alone lets the player pull from googlevideo
// directly, which is the comparison worth being able to make from the sofa.
//
// It only means anything on that path. Under CDP injection the page *is* youtube.com and
// the service was never in the video path, so this does nothing there and says so.
//
// Whether direct playback works at all is the open question: googlevideo has to answer a
// cross-origin request from a localhost page, and it being unwilling to is the reason the
// media was proxied in the first place. If the picture stops, turn it back off.

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
