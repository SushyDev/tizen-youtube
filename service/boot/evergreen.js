// Cobalt's own name for "no installation manager": the loader was told to skip updates.
const UPDATES_OFF = 1000;

const read = (updater, name) => {
    try {
        return typeof updater[name] === 'function' ? updater[name]() : null;
    } catch (e) {
        return null;
    }
};

const library = (index) => {
    if (index === UPDATES_OFF) return 'built-in, updates off';
    if (index === 0) return 'built-in';
    return `evergreen update ${index}`;
};

export const evergreen = () => {
    const updater = window.h5vcc && window.h5vcc.updater;
    if (!updater) return null;

    const index = read(updater, 'getInstallationIndex');
    const channel = read(updater, 'getUpdaterChannel');
    const status = read(updater, 'getUpdateStatus');

    const parts = [
        index === null ? null : `installation ${index} (${library(index)})`,
        channel ? `channel ${channel}` : null,
        status ? `update ${status}` : null
    ].filter(Boolean);

    return parts.length ? parts.join(', ') : null;
};
