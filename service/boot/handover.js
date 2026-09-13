import { target } from './config.js';
import { TIMING } from './timing.js';
import { held } from './state.js';
import { say } from './screen.js';
import { flush } from './outbox.js';

// The query carries Cobalt's device sign-in.
const go = () => window.location.replace(`${target}${window.location.search}${window.location.hash}`);

export const handOver = () => {
    held.handed = true;

    say('tube', 'youtube answers through the service', 'ok');
    say('tube', `handing over to ${target}`, 'ok');
    flush();

    setTimeout(go, TIMING.linger);
};
