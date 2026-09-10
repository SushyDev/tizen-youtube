// The feed, one concern per file. surfaces.js does the walking; the rest register visitors or
// dress the response. Order is registration order, and surfaces goes first so a shelf is walked
// before anything is added to the list it sits in.

import './surfaces.js';
import './adblock.js';
import './deArrow.js';
import './thumbnails.js';
import './longPress.js';
import './hideWatched.js';
import './shorts.js';
import './signinReminder.js';
import './endScreen.js';
import './paidPromotion.js';
import './youThere.js';
