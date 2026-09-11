// Handlers run in registration order, so reordering these imports reorders them.

import { boot, interceptJson, register } from '../framework/index.js';
import { start as startNetwork } from './network/originRewrite.js';
import { start as startTheme } from './shell/oledTheme.js';
import { start as startSettings } from './settings/nativeSettings.js';
import { start as startShell } from './shell/startup.js';
import { start as startSpeed } from './player/speed.js';

import './feed/adblock.js';
import './shell/guide.js';
import './sponsorblock/sponsorblock.js';
import './subtitles/moreSubtitles.js';
import './player/preferredQuality.js';
import './queue/queue.js';
import './shell/ytFlags.js';
import './player/pictureInPicture.js';
import './player/customUI.js';
import './shell/whosWatching.js';

import './dev/index.js';

register('origin rewrite', 'network', startNetwork);
register('oled theme', 'paint', startTheme);
register('native settings', 'settings', startSettings);
register('ui shell', 'ui', startShell);
register('playback speed', 'ui', startSpeed);

// Taking over JSON.parse seals registration, so it is a phase rather than a last line.
register('json', 'intercept', interceptJson);

boot();
