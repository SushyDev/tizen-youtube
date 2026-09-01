// The userscript. One bundle: the floor is Tizen 5, whose engine needs no core-js,
// no fetch polyfill, no DOMRect polyfill and no ES5 downlevel. Those existed for
// Chrome 47 on Tizen 3 and 4, and were parse-and-execute cost on every launch for
// every set that never needed them.

import "./core.js";
