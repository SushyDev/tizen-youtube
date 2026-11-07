import { held } from './state.js';
import { say } from './screen.js';
import { whenPressed } from './card.js';
import { handOver, cancelHandOver } from './handover.js';
import { autoLaunch, setAutoLaunch } from './settings.js';
import { restartService } from './restart.js';
import { allReady, canLaunch, model, refresh } from './view.js';

const OK = 13;
const UP = 38;
const DOWN = 40;

// Cobalt sends Escape for Back, the web runtime XF86Back, and some remotes Backspace.
const BACK = [27, 8, 10009, 461];

const showView = (view) => {
    held.view = view;
    refresh();
};

const launch = () => {
    if (!canLaunch()) return;

    const ready = allReady();
    say('tube', ready ? 'launch pressed' : 'launch anyway pressed, before every check passed', ready ? '' : 'warn');
    handOver();
};

export const stop = () => {
    if (held.handed) cancelHandOver();

    held.launching = false;
    held.moved = false;
    say('tube', 'stopped: showing the launcher');
    refresh();
};

const toggleAuto = () => {
    setAutoLaunch(!autoLaunch());
    say('tube', `auto-launch switched ${autoLaunch() ? 'on' : 'off'}`);
    refresh();
};

const ACTIONS = {
    launch,
    stop,
    logs: () => showView('logs'),
    restart: restartService,
    auto: toggleAuto
};

export const press = (id) => (ACTIONS[id] ? ACTIONS[id]() : undefined);

const move = (step) => {
    const usable = model().buttons.filter((one) => !one.off).map((one) => one.id);
    if (!usable.length) return;

    const at = usable.indexOf(held.focus);
    held.focus = usable[Math.max(0, Math.min(usable.length - 1, at === -1 ? 0 : at + step))];
    held.moved = true;
    refresh();
};

const handled = (event) => {
    if (event.preventDefault) event.preventDefault();
    return true;
};

const onKey = (event) => {
    const code = event.keyCode;
    const back = BACK.indexOf(code) !== -1;

    if (held.view === 'logs') {
        if (code === OK || back) handled(event) && showView('launcher');
        return;
    }

    if (code === UP || code === DOWN) {
        handled(event);
        move(code === UP ? -1 : 1);
    } else if (code === OK) {
        handled(event);
        press(held.focus);
    } else if (back && (held.launching || held.handed)) {
        // Back on the launcher itself is left alone, so it still leaves Tube.
        handled(event);
        stop();
    }
};

export const listen = () => {
    whenPressed(press);
    if (document.addEventListener) document.addEventListener('keydown', onKey);
};
