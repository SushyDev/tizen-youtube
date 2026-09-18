// Handlers run in registration order, so reordering these imports reorders them.

import { boot, interceptJson, register } from '../framework/index.js';
import { start as startNetwork } from './network/originRewrite.js';
import { start as startSettings } from './settings/nativeSettings.js';
import { start as startShell } from './shell/startup.js';
import { start as startPage } from './shell/startPage.js';
import { start as startScrollSpeed } from './shell/scrollSpeed.js';
import { start as startRapidPress } from './shell/rapidPress.js';
import { start as startSmoothNavigation } from './shell/smoothNavigation.js';
import { start as startSpeed } from './player/speed.js';

import './feed/index.js';
import './shell/guide.js';
import './shell/deArrowLive.js';
import './sponsorblock/sponsorblock.js';
import './subtitles/index.js';
import './player/preferredQuality.js';
import './queue/queue.js';
import './player/pictureInPicture.js';
import './player/playerButtons.js';
import './player/autoplay.js';
import './player/overlays.js';
import './player/codecs.js';
import './dislike/count.js';
import './dislike/live.js';
import './dislike/action.js';
import './dislike/focusGuard.js';
import './queue/shelf.js';
import './sponsorblock/manualSkips.js';
import './sponsorblock/highlight.js';
import './shell/whosWatching.js';

import './dev/index.js';

register('origin rewrite', 'network', startNetwork);
register('native settings', 'settings', startSettings);
register('ui shell', 'ui', startShell);
register('start page', 'ui', startPage);

register('scroll speed', 'ui', startScrollSpeed);
register('rapid press', 'ui', startRapidPress);
register('smooth navigation', 'ui', startSmoothNavigation);
register('playback speed', 'ui', startSpeed);

// Taking over JSON.parse seals registration.
register('json', 'intercept', interceptJson);

// Must stay synchronous: the start page writes what kabuki's own script reads as it starts, which works only because ours is parser-inserted.
boot();
