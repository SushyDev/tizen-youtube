import { answerSwitch, configRead } from '../../framework/index.js';

const SWITCHES = {
    enableCancellableJobDeferral: true,
    enableDeferredThumbnailOnScroll: true,
    enableVirtualListItemTransition: false
};

const wanted = () => configRead('enableSmoothNavigation');

const start = () => Object.keys(SWITCHES).forEach((name) =>
    answerSwitch(name, () => (wanted() ? SWITCHES[name] : undefined)));

export { start, SWITCHES };
