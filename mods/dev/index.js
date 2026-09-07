// Everything that only exists when someone is watching.
//
// The `if (DEV_TOOLS)` shape is load bearing. DEV_TOOLS folds to a literal false at build time,
// terser drops the block, and its `unused` pass then drops the modules it referenced. An array
// like FEATURES.concat(DEV_TOOLS ? [...] : []) folds the array and keeps the functions.

import { DEV_TOOLS, register } from '../../framework/index.js';
import { start as startBridge } from './devBridge.js';
import './playerProbe.js';

if (DEV_TOOLS) {
    register('dev bridge', 'ui', startBridge);
}
