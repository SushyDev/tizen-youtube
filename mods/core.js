// What this app is, in the order it happens. The ordering is not stylistic: ES module
// imports are evaluated depth-first, so a module that captures `window.fetch` or
// `JSON.parse` during its own evaluation gets whatever was there at that moment. This
// file is arranged so that is always ours.

// Before anything else, and before YouTube's own bundle: what this set claims it can
// decode decides which codec the server sends, and the server decides that once. See
// features/codecCapability.js — this is the difference between 4K60 in hardware and 4K60
// on the CPU.
import installCodecCapability from './features/codecCapability.js';
installCodecCapability();

// Features: each registers what it wants and does nothing else at import time.
// Nothing is intercepted until the last line of this file.

// First of the features: it repaints the splash that is already on screen, so every
// module evaluated ahead of it is a frame the screen stays grey.
import './features/oledTheme.js';     // true black, when the setting asks for it

import './features/adblock.js';        // and DeArrow, shelves, thumbnails
import './features/sponsorblock.js';
import './features/guide.js';          // the sidebar, trimmed
import './features/moreSubtitles.js';
import './features/preferredVideoQuality.js';
import './features/videoQueuing.js';
import './features/enableFeatures.js';
import './features/pictureInPicture.js';

import './ui/ui.js';                   // wiring, keys, start page
import './ui/speedUI.js';
import './ui/customUI.js';             // the buttons under the player
import './ui/disableWhosWatching.js';

import { interceptJson } from './youtube/json.js';

// Everything above has registered by now: one patch, installed once, with the full
// set of readers already in hand.
interceptJson();
