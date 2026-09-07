import { DEV_TOOLS } from '../../framework/index.js';
import { rewrites } from '../shell/oledTheme.js';

if (DEV_TOOLS && typeof window !== 'undefined') {
    window.__tube = { rewrites };
}
