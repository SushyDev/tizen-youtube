// What this app is, in the order it happens.
//
// Read top to bottom and the whole modification is here: first the two things
// that must exist before YouTube's own code runs, then the features, then the
// switch that turns the interception on.
//
// The ordering is not stylistic. ES module imports are hoisted and evaluated
// depth-first, so a module that captures `window.fetch` or `JSON.parse` during
// its own evaluation captures whatever was there at that moment. Everything
// below is arranged so that "whatever was there" is always ours.

// ── Before anything else ──────────────────────────────────────────────

// Redirects YouTube's own network calls at the local proxy. Only does anything
// on the proxy path; on the injected path the page is already youtube.com.
import './features/standaloneUserscript.js';

// ── The features ──────────────────────────────────────────────────────
//
// Each of these registers what it wants and does nothing else at import time.
// Nothing is intercepted until the last line of this file.

import './features/adblock.js';        // and DeArrow, shelves, thumbnails
import './features/sponsorblock.js';
import './features/guide.js';          // the sidebar, trimmed
import './features/moreSubtitles.js';
import './features/preferredVideoQuality.js';
import './features/videoQueuing.js';
import './features/enableFeatures.js';
import './features/pictureInPicture.js';

// ── The interface ─────────────────────────────────────────────────────

import './ui/ui.js';                   // wiring, keys, start page
import './ui/settings.js';             // the Additional options panel
import './ui/speedUI.js';
import './ui/customUI.js';             // the buttons under the player
import './ui/disableWhosWatching.js';

// ── Go ────────────────────────────────────────────────────────────────

import { interceptJson } from './youtube/json.js';

// Everything above has registered by the time this runs, which is the point:
// one patch, installed once, with the full set of readers already in hand.
interceptJson();
