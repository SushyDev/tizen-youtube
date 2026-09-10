import { answerSwitch, configRead } from '../../framework/index.js';

// Work YouTube does while you are moving, which it does not have to.
//
// Scroll speed shortens the animation, and past about 2x that stops being what is slow: measured on
// the set a move costs ~81ms on a light page and ~165ms on the home feed, and the difference is
// drawing rather than animating. So the remaining lever is not pacing, it is doing less per move.
//
// These are three of YouTube's own render-path switches, all of which arrive off on this
// television. They are not settings a viewer can reason about one by one, so they are one switch:
//
//   cancellable job deferral      deferred work can be abandoned when it is overtaken, rather than
//                                 running to completion for a row already scrolled past.
//   deferred thumbnails on scroll thumbnails are not fetched for rows being moved through.
//   item transitions off          every tile carries its own `transform … ms` on every move. The
//                                 list already animates as a whole; this is the per-item layer on
//                                 top of it, and it is the one that costs per tile rather than
//                                 per move.
//
// The last one is visible as well as felt — tiles stop sliding individually — which is the reason
// this is a setting rather than simply on.

const SWITCHES = {
    enableCancellableJobDeferral: true,
    enableDeferredThumbnailOnScroll: true,
    enableVirtualListItemTransition: false
};

const wanted = () => configRead('enableSmoothNavigation');

// Undefined when off, so YouTube's own values stand and this is indistinguishable from absent.
const start = () => Object.keys(SWITCHES).forEach((name) =>
    answerSwitch(name, () => (wanted() ? SWITCHES[name] : undefined)));

export { start, SWITCHES };
