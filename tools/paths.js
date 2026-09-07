'use strict';

// Where everything lands.
//
// These were string literals in build.js, clean.js, package.js and release.js, so the artefact
// contract was written out four times and nothing checked the four agreed. config.js owns what
// the build *is* — version, origin, the git stamp; this owns where it goes.

const DIST = 'dist';
const BUNDLE = 'dist/userScript.js';

const SERVICE_DIST = 'service/dist';
const SERVICE_BUNDLE = 'service/dist/index.js';
const SERVICE_ASSETS = 'service/dist/assets';

const RELEASE = 'release';
const WGT = 'release/tube.wgt';
const ORIGIN_STAGING = 'release/origin';

// app/ is a source directory, not an archive path. Tizen resolves <content src> and <icon src>
// relative to the archive root, and service/lib/cobalt.js reads ../../config.xml at runtime from
// service/dist/, so config.xml has to arrive at the top of the widget however it is filed here.
const WIDGET = [
    { from: 'app/config.xml', to: 'config.xml' },
    { from: 'app/icon.png', to: 'icon.png' },
    { from: 'app/index.html', to: 'index.html' },
    { from: 'service/dist', to: 'service/dist' }
];

// Published to the CDN rather than packaged: the userscript fetches it at runtime.
const OTA_ASSETS = [{ from: 'app/assets/language-names.json', to: 'language-names.json' }];

const ARTEFACTS = [DIST, SERVICE_DIST, RELEASE];

module.exports = {
    DIST, BUNDLE,
    SERVICE_DIST, SERVICE_BUNDLE, SERVICE_ASSETS,
    RELEASE, WGT, ORIGIN_STAGING,
    WIDGET, OTA_ASSETS, ARTEFACTS
};
