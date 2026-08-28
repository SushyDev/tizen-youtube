// Modern bundle: Chrome 63+ (Tizen 5.5 and newer).
//
// No core-js, no fetch polyfill, no DOMRect polyfill and no ES5 downlevel.
// Those exist only for Chrome 47 and are pure parse-and-execute cost on every
// launch for TVs that have never needed them.
import "./core.js";
