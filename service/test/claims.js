'use strict';

const os = require('os');
const path = require('path');
const { readFileSync } = require('fs');

const LOG = path.join(os.tmpdir(), `tube-claims-${process.pid}.log`);
process.env.TUBE_LOG = LOG;

const NATIVE_ID = 'http://samsung.com/tv/metadata/nativeID';
const USERDATA = 'http://samsung.com/tv/metadata/native.userdata';

const METADATA = {
    'tUb3Xq7Lm9.Tube': [
        { key: NATIVE_ID, value: 'com.samsung.tv.cobalt-yt' },
        { key: USERDATA, value: '--base_url=file:///tube/boot.html --proxy=http://127.0.0.2:8099' }
    ],
    'other.TizenTube': [{ key: NATIVE_ID, value: 'com.samsung.tv.cobalt-yt' }],
    'plain.App': []
};

global.tizen = {
    application: {
        getAppsInfo: (answer) => answer([
            { id: 'tUb3Xq7Lm9.Tube', name: 'YouTube', version: '1.0.1' },
            { id: 'other.TizenTube', name: 'TizenTube', version: '2.0.0' },
            { id: 'plain.App', name: 'Weather', version: '1.0.0' },
            { id: 'locked.App', name: 'Locked', version: '1.0.0' }
        ]),
        getAppMetaData: (id) => {
            if (!METADATA[id]) throw Object.assign(new Error('Permission denied'), { name: 'SecurityError' });
            return METADATA[id];
        }
    }
};

// Our own manifest: off the set only a stand-in gives one, and rivals() excludes us by app id.
require.cache[require.resolve('../lib/cobaltConfig.js')] = {
    exports: {
        CONTAINER: 'com.samsung.tv.cobalt-yt',
        config: () => '<widget/>',
        switches: () => '',
        configuredContent: () => null,
        container: () => 'com.samsung.tv.cobalt-yt',
        appId: () => 'tUb3Xq7Lm9.Tube'
    }
};

const claimants = require('../lib/claimants.js');

// Asked before the survey answers, which is not the same as there being no rival.
const beforeSurvey = claimants.rivals();

claimants.survey();

const log = readFileSync(LOG, 'utf8');

const results = [];
const check = (label, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    results.push(!!ok);
};

check('our claim is named with its base URL',
    log.indexOf('tUb3Xq7Lm9.Tube "YouTube" 1.0.1 → com.samsung.tv.cobalt-yt file:///tube/boot.html') !== -1);
check('so is any other app on the slot', log.indexOf('other.TizenTube "TizenTube" 2.0.0 → com.samsung.tv.cobalt-yt') !== -1);
check('an app claiming nothing is left out', log.indexOf('Weather') === -1);
check('metadata it may not read is counted', log.indexOf('1 apps\' metadata unreadable: Permission denied') !== -1);

check('before the survey answers, no claim is reported rather than none', beforeSurvey === null);

const others = claimants.rivals();

check('a second app on our slot is a rival', others.length === 1 && others[0].id === 'other.TizenTube');
check('and we are never a rival to ourselves', others.every((one) => one.id !== 'tUb3Xq7Lm9.Tube'));
check('a rival carries what names it on the diagnostics page',
    others[0].name === 'TizenTube' && others[0].slot === 'com.samsung.tv.cobalt-yt');

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
