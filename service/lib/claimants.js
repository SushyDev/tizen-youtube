'use strict';

const postmortem = require('./postmortem.js');
const { CONTAINER, appId } = require('./cobaltConfig.js');

const NATIVE_ID = 'http://samsung.com/tv/metadata/nativeID';
const USERDATA = 'http://samsung.com/tv/metadata/native.userdata';

// A container already running keeps the switches of whichever app launched it, and one we did not
// start is one we may not close.
const state = { surveyed: false, claims: [], at: 0, asking: false, said: '' };

// Apps installed after the service started claim the slot too, so a survey this old is taken again.
const FRESH = 30000;

const note = (detail) => postmortem.note('claims', detail);

const metadataOf = (id) => {
    try {
        return { entries: tizen.application.getAppMetaData(id) };
    } catch (e) {
        return { entries: [], error: e.message };
    }
};

const valueOf = (entries, key) => (entries.find((entry) => entry.key === key) || {}).value || '';

const baseUrlOf = (entries) => {
    const found = /--base_url=(\S+)/.exec(valueOf(entries, USERDATA));
    return found ? found[1] : null;
};

const describe = (app, entries) => {
    const base = baseUrlOf(entries);
    return `${app.id} "${app.name}" ${app.version} → ${valueOf(entries, NATIVE_ID)}${base ? ` ${base}` : ''}`;
};

const recordOf = (app, entries) => ({
    id: app.id,
    name: app.name,
    version: app.version,
    slot: valueOf(entries, NATIVE_ID),
    baseUrl: baseUrlOf(entries)
});

const report = (apps) => {
    const read = apps.map((app) => Object.assign({ app }, metadataOf(app.id)));
    const claims = read.filter((found) => valueOf(found.entries, NATIVE_ID));
    const refused = read.filter((found) => found.error);

    state.claims = claims.map((found) => recordOf(found.app, found.entries));
    state.surveyed = true;
    state.asking = false;
    state.at = Date.now();

    // Logged only when it changed, because a fresh survey every half minute would otherwise fill the log.
    const lines = claims.map((found) => describe(found.app, found.entries))
        .concat(claims.length ? [] : [`none of ${apps.length} apps claims a container slot`])
        .concat(refused.length ? [`${refused.length} apps' metadata unreadable: ${refused[0].error}`] : []);

    if (lines.join('\n') === state.said) return;
    state.said = lines.join('\n');
    lines.forEach(note);
};

const survey = () => {
    if (typeof tizen === 'undefined' || state.asking) return;
    state.asking = true;

    const failed = (why) => {
        state.asking = false;
        note(`could not list apps: ${why}`);
    };

    try {
        tizen.application.getAppsInfo(report, (error) => failed(error.message));
    } catch (e) {
        failed(postmortem.describe(e));
    }
};

// null while the survey has not answered, which is not the same as none; a stale answer is given and retaken.
const rivals = () => {
    if (state.surveyed && Date.now() - state.at > FRESH) survey();

    return state.surveyed
        ? state.claims.filter((claim) => claim.slot === CONTAINER && claim.id !== appId())
        : null;
};

module.exports = { survey, rivals };
