import { answerSwitch, configRead } from '../../framework/index.js';

// Sets three render-path switches that cut per-move work; tiles stop sliding individually.

const SWITCHES = {
    enableCancellableJobDeferral: true,
    enableDeferredThumbnailOnScroll: true,
    enableVirtualListItemTransition: false
};

const wanted = () => configRead('enableSmoothNavigation');

const start = () => Object.keys(SWITCHES).forEach((name) =>
    answerSwitch(name, () => (wanted() ? SWITCHES[name] : undefined)));

export { start, SWITCHES };
