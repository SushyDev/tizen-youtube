import './features/standaloneUserscript.js';

import './features/oledTheme.js';

import './features/adblock.js';
import './features/sponsorblock.js';
import './features/guide.js';
import './features/moreSubtitles.js';
import './features/preferredVideoQuality.js';
import './features/videoQueuing.js';
import './features/enableFeatures.js';
import './features/pictureInPicture.js';

import './ui/ui.js';
import './ui/speedUI.js';
import './ui/customUI.js';
import './ui/disableWhosWatching.js';

import { interceptJson } from './youtube/json.js';

interceptJson();
