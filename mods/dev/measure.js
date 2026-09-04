import { DEV_TOOLS } from './tools.js';
import { pagePlayerSays, chooseQuality } from '../features/nativePlayback.js';
import { rewrites } from '../features/oledTheme.js';
import { withholdMedia, withholdingMedia, withholdAhead } from '../youtube/mediaSource.js';

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
