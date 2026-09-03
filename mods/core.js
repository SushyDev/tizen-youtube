// ES module imports are evaluated depth-first, so a module that captures `window.fetch`
// or `JSON.parse` as it is evaluated gets whatever was there at that moment. The order of
// these imports is what keeps that always ours.

import './features/standaloneUserscript.js';

import './features/oledTheme.js';

import './features/adblock.js';
import './features/sponsorblock.js';
import './features/guide.js';
import './features/moreSubtitles.js';
import './features/preferredVideoQuality.js';
import './features/playbackStats.js';
import './features/devBridge.js';
import './youtube/playerRequest.js';
import './dev/playerProbe.js';
import './features/nativePlayback.js';
import './features/videoQueuing.js';
import './features/enableFeatures.js';
import './features/pictureInPicture.js';

import './ui/ui.js';
import './ui/speedUI.js';
import './ui/customUI.js';
import './ui/disableWhosWatching.js';

import { interceptJson } from './youtube/json.js';

interceptJson();
