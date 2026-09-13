// The boot screen: a dmesg-style log shown until YouTube can load.

import { service } from './config.js';
import { engine } from './engine.js';
import { say } from './screen.js';
import { poll } from './poll.js';

say('tube', `boot screen, ${engine()}`, 'note');
say('tube', `viewport ${window.innerWidth}x${window.innerHeight}, dpr ${window.devicePixelRatio || 1}`);
say('service', `waiting for it at ${service.replace('http://', '')}`);

window.onerror = (message, source, line) => say('tube', `page error: ${message} (line ${line})`, 'bad');

poll();
