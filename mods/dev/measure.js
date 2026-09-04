import { DEV_TOOLS } from './tools.js';
import { pagePlayerSays, chooseQuality } from '../features/nativePlayback.js';
import { rewrites } from '../features/oledTheme.js';
import { withholdMedia, withholdingMedia, withholdAhead } from '../youtube/mediaSource.js';

// Two things this app does to the page cannot be measured from outside while it is doing
// them. Correcting what the player reports hides the page player's own choice, which is
// the thing under test whenever the second download is worked on; and withholding the
// buffer hides the download itself, whose volume is the measurement. Both are readable
// and one is switchable here, so a baseline can be taken without a rebuild.
//
// A third: the fault being chased is a race between a seek and a quality change — one
// that has to be provoked within a second or two of the other, which nobody can do
// reliably from a sofa with a remote. `chooseQuality` is the same call the settings panel
// makes, so a script can drive both halves of the race at a known interval.
//
// Behind DEV_TOOLS, so a release build carries none of it.
if (DEV_TOOLS && typeof window !== 'undefined') {
    window.__tube = {
        pagePlayerSays,
        chooseQuality,
        rewrites,
        withholdMedia,
        withholdingMedia,
        withholdAhead
    };
}
