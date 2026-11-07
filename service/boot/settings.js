const AUTO = 'tube.launcher.auto';

// Remembered here too, so a switch still works for this visit on a TV without storage.
const memory = { auto: null };

// On unless switched off, so Tube opens straight into YouTube as it always has.
export const autoLaunch = () => {
    if (memory.auto !== null) return memory.auto;

    try {
        return window.localStorage.getItem(AUTO) !== 'off';
    } catch (e) {
        return true;
    }
};

export const setAutoLaunch = (on) => {
    memory.auto = on;

    try {
        window.localStorage.setItem(AUTO, on ? 'on' : 'off');
    } catch (e) { /* kept for this visit only */ }
};
