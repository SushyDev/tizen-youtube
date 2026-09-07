// What the userscript is, in the order it happens.
//
// This was sixteen side-effecting imports, and the order of that list was the boot order without
// anything saying so. Reordering it silently reordered the writer pipeline, and interceptJson()
// had to be last for reasons expressed only by its line number. Now each module registers what it
// wants and which phase it belongs to, boot() runs the phases, and nothing runs at import.

import { boot, interceptJson, register } from '../framework/index.js';
import { start as startNetwork } from './network/originRewrite.js';
import { start as startTheme } from './shell/oledTheme.js';
import { start as startSettings } from './settings/nativeSettings.js';
import { start as startShell } from './shell/startup.js';
import { start as startSpeed } from './player/speed.js';

// Registered by importing: these declare feed readers, tile visitors and command interpreters at
// import time and have nothing to start.
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

// Synchronous, and it has to stay that way: preferredVideoQuality seeds localStorage before
// kabuki's own script reads it, which works only because ours is parser-inserted.
boot();
