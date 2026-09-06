import { DEV_TOOLS } from './tools.js';
import { rewrites } from '../features/oledTheme.js';

if (DEV_TOOLS && typeof window !== 'undefined') {
    window.__tube = { rewrites };
}
