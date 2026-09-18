// Handlers run in registration order, so reordering these imports reorders them.

import { boot, interceptJson, register } from '../framework/index.js';
import { start as startNetwork } from './network/originRewrite.js';
import { start as startSettings } from './settings/nativeSettings.js';
import { start as startShell } from './shell/startup.js';
import { start as startPage } from './shell/startPage.js';
import { start as startScrollSpeed } from './scroller/speed.js';
import { start as startRapidPress } from './scroller/rapidPress.js';
import { start as startSmoothNavigation } from './scroller/smoothNavigation.js';
import { start as startSpeed } from './player/speed.js';

import './feed/index.js';
import './adblock/index.js';
import './dearrow/index.js';
import './thumbnails/index.js';
import './longPressMenu/index.js';
import './hideWatched/index.js';
import './shorts/index.js';
import './signinReminder/index.js';
import './endScreen/index.js';
import './paidPromotion/index.js';
import './youThere/index.js';
import './shell/guide.js';
import './sponsorblock/index.js';
import './subtitles/index.js';
import './quality/index.js';
import './queue/queue.js';
import './player/index.js';
import './dislike/index.js';
import './queue/shelf.js';
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
