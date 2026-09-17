'use strict';

const postmortem = require('./postmortem.js');
const { CONTAINER, appId } = require('./cobaltConfig.js');

const NATIVE_ID = 'http://samsung.com/tv/metadata/nativeID';
const USERDATA = 'http://samsung.com/tv/metadata/native.userdata';

// A container already running keeps the switches of whichever app launched it, and one we did not
// start is one we may not close.
const state = { surveyed: false, claims: [] };

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

    claims.forEach((found) => note(describe(found.app, found.entries)));
    if (!claims.length) note(`none of ${apps.length} apps claims a container slot`);
    if (refused.length) note(`${refused.length} apps' metadata unreadable: ${refused[0].error}`);
};

// null while the survey has not answered, which is not the same as none.
const rivals = () => (state.surveyed
    ? state.claims.filter((claim) => claim.slot === CONTAINER && claim.id !== appId())
    : null);

const survey = () => {
    if (typeof tizen === 'undefined') return;

    try {
        tizen.application.getAppsInfo(report, (error) => note(`could not list apps: ${error.message}`));
    } catch (e) {
        note(`could not list apps: ${postmortem.describe(e)}`);
    }
};

module.exports = { survey, rivals };
