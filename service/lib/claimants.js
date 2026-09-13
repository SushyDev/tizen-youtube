'use strict';

// Every installed app claiming a container slot, since another claimant can take our switches.

const postmortem = require('./postmortem.js');

const NATIVE_ID = 'http://samsung.com/tv/metadata/nativeID';
const USERDATA = 'http://samsung.com/tv/metadata/native.userdata';

const note = (detail) => postmortem.note('claims', detail);

const metadataOf = (id) => {
    try {
        return { entries: tizen.application.getAppMetaData(id) };
    } catch (e) {
        return { entries: [], error: e.message };
    }
};

const valueOf = (entries, key) => (entries.find((entry) => entry.key === key) || {}).value || '';

const describe = (app, entries) => {
    const base = /--base_url=(\S+)/.exec(valueOf(entries, USERDATA));
    return `${app.id} "${app.name}" ${app.version} → ${valueOf(entries, NATIVE_ID)}${base ? ` ${base[1]}` : ''}`;
};

const report = (apps) => {
    const read = apps.map((app) => Object.assign({ app }, metadataOf(app.id)));
    const claims = read.filter((found) => valueOf(found.entries, NATIVE_ID));
    const refused = read.filter((found) => found.error);

    claims.forEach((found) => note(describe(found.app, found.entries)));
    if (!claims.length) note(`none of ${apps.length} apps claims a container slot`);
    if (refused.length) note(`${refused.length} apps' metadata unreadable: ${refused[0].error}`);
};

const survey = () => {
    if (typeof tizen === 'undefined') return;

    try {
        tizen.application.getAppsInfo(report, (error) => note(`could not list apps: ${error.message}`));
    } catch (e) {
        note(`could not list apps: ${postmortem.describe(e)}`);
    }
};

module.exports = { survey };
