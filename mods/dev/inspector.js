import { after } from '../../framework/index.js';
import { shim } from './domShims.js';

// Same-origin: Cobalt proxies HTTP but not WebSockets.
const MOUNT = '/__tube/chii/target.js';

// Attaching while kabuki boots blacks the screen.
const ATTACH_AFTER = 6000;

const SWITCH = 'tube.inspector';

// Cleared on read so a crashing inspector costs one launch.
const wanted = () => {
    try {
        const asked = window.localStorage.getItem(SWITCH) === 'on';
        if (asked) window.localStorage.removeItem(SWITCH);
        return asked;
    } catch (e) {
        return false;
    }
};

const attach = () => {
    shim();

    const nonced = document.querySelector('script[nonce]');
    const script = document.createElement('script');

    // The page is served under a nonce policy; a script without it is refused.
    if (nonced && nonced.nonce) script.nonce = nonced.nonce;

    script.src = MOUNT;
    document.head.appendChild(script);
};

const start = () => {
    if (!wanted()) return;

    after('inspector', ATTACH_AFTER, () => {
        // Probed first so a build without an inspector appends no dead script tag.
        fetch(MOUNT)
            .then((answer) => (answer.ok ? attach() : undefined))
            .catch(() => undefined);
    });
};

export { start };
