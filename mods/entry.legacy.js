// Legacy bundle: Chrome 47 (Tizen 3 and 4). Polyfills load before the feature set so
// patched globals are in place by the time any feature module evaluates.
import "whatwg-fetch";
import "core-js/proposals/object-getownpropertydescriptors";
import "./domrect-polyfill";

import "./core.js";
