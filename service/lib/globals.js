'use strict';

// Web globals that Node grew later than some of these televisions did.
//
// `Event` and `EventTarget` became Node globals in 15.4 and 15.0. A bundled dependency declares
// `class CustomEvent extends Event` at load time, so on an older runtime requiring the service
// throws `ReferenceError: Event is not defined` before a single line of ours runs. The process
// then dies during `require` — no port, no route, nothing to ask — and from the outside it is
// indistinguishable from a service the platform never launched. That is what a Tizen 6.5 set on
// Node 12.16.3 did, while a 9.0 set on Node 18 ran the identical bundle without complaint.
//
// This has to be required before anything else in the service, and it defines only enough for the
// declarations to evaluate and for ordinary listener use to behave.

function define(name, value) {
    if (typeof globalThis === 'undefined') return;
    if (typeof globalThis[name] !== 'undefined') return;

    globalThis[name] = value;
}

class TubeEvent {
    constructor(type, options) {
        this.type = String(type);
        this.cancelable = !!(options && options.cancelable);
        this.bubbles = !!(options && options.bubbles);
        this.defaultPrevented = false;
        this.target = null;
    }

    preventDefault() {
        if (this.cancelable) this.defaultPrevented = true;
    }

    stopPropagation() {}

    stopImmediatePropagation() {}
}

class TubeEventTarget {
    constructor() {
        this.__tubeListeners = {};
    }

    addEventListener(type, listener) {
        if (typeof listener !== 'function') return;

        const key = String(type);
        if (!this.__tubeListeners) this.__tubeListeners = {};
        if (!this.__tubeListeners[key]) this.__tubeListeners[key] = [];
        if (this.__tubeListeners[key].indexOf(listener) === -1) this.__tubeListeners[key].push(listener);
    }

    removeEventListener(type, listener) {
        const found = this.__tubeListeners && this.__tubeListeners[String(type)];
        if (!found) return;

        const at = found.indexOf(listener);
        if (at !== -1) found.splice(at, 1);
    }

    dispatchEvent(event) {
        const found = this.__tubeListeners && this.__tubeListeners[String(event && event.type)];
        if (event && typeof event === 'object') event.target = this;

        (found || []).slice().forEach((listener) => {
            try { listener.call(this, event); } catch (e) { /* a listener must not stop the rest */ }
        });

        return !(event && event.defaultPrevented);
    }
}

define('Event', TubeEvent);
define('EventTarget', TubeEventTarget);

module.exports = { TubeEvent, TubeEventTarget };
