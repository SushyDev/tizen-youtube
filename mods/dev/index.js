// The `if (DEV_TOOLS)` shape is load bearing: DEV_TOOLS folds to a literal false at build time, so
// terser drops the block and then the modules it referenced.

import { DEV_TOOLS, register } from '../../framework/index.js';
import { start as startBridge } from './devBridge.js';
import { start as startInspector } from './inspector.js';
import { start as startNativeJson } from './nativeJson.js';
import './playerProbe.js';

if (DEV_TOOLS) {
    register('dev bridge', 'ui', startBridge);
    register('native json', 'ui', startNativeJson);
    register('inspector', 'ui', startInspector);
}
