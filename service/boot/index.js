// The boot screen: a dmesg-style log shown until YouTube can load.

import { service, written } from './config.js';
import { engine } from './engine.js';
import { evergreen } from './evergreen.js';
import { ago } from './clock.js';
import { say } from './screen.js';
import { poll } from './poll.js';

say('tube', `boot screen, ${engine()}`, 'note');

const updates = evergreen();
if (updates) say('cobalt', updates);
say('tube', `viewport ${window.innerWidth}x${window.innerHeight}, dpr ${window.devicePixelRatio || 1}`);

// An old page means the service has not run since.
if (written) say('tube', `page written ${ago(written.at)} ago by service pid ${written.pid}, patch ${written.patch}`);

say('service', `waiting for it at ${service.replace('http://', '')}`);

window.onerror = (message, source, line) => say('tube', `page error: ${message} (line ${line})`, 'bad');

poll();
