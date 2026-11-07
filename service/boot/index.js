import { service, written } from './config.js';
import { engine } from './engine.js';
import { evergreen } from './evergreen.js';
import { ago } from './clock.js';
import { say } from './screen.js';
import { poll } from './poll.js';
import { refresh } from './view.js';
import { lastRun, describeRun } from './trail.js';
import { autoLaunch } from './settings.js';
import { listen } from './controls.js';
import { held } from './state.js';

say('tube', `boot screen, ${engine()}`, 'note');

const updates = evergreen();
if (updates) say('cobalt', updates);
say('tube', `viewport ${window.innerWidth}x${window.innerHeight}, dpr ${window.devicePixelRatio || 1}`);

// An old page means the service has not run since.
if (written) say('tube', `page written ${ago(written.at)} ago by service pid ${written.pid}, patch ${written.patch}`);

// Read from a file the service wrote, so it still says how far the last start got when nothing answers.
if (lastRun()) say('service', `last run ${describeRun(lastRun())}`);

say('service', `waiting for it at ${service.replace('http://', '')}`);

window.onerror = (message, source, line) => say('tube', `page error: ${message} (line ${line})`, 'bad');

// Sized from the screen, so the launcher looks the same at 720p and 1080p.
if (document.body) document.body.style.fontSize = `${Math.max(14, Math.round((window.innerHeight || 1080) / 36))}px`;

// Opened from Tube's settings inside YouTube, which means the viewer came to look rather than to leave again.
const asked = /launcher/.test(window.location.hash || '');

held.launching = autoLaunch() && !asked;
say('tube', held.launching ? 'auto-launch is on: opening YouTube as soon as everything is ready'
    : `${asked ? 'opened from Tube\'s settings' : 'auto-launch is off'}: showing the launcher`);
listen();

refresh();
poll();
