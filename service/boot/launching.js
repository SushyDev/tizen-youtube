import { held } from './state.js';
import { say } from './screen.js';

// Auto-launch gives way as soon as something is wrong, so the viewer sees what and can launch anyway.
export const stopLaunching = (why) => {
    if (!held.launching || held.handed) return;

    held.launching = false;
    held.moved = false;
    say('tube', `auto-launch stopped: ${why}`, 'warn');
};
