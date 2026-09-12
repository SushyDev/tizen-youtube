'use strict';

// Where everything lands.
//
// These were string literals in build.js, clean.js, package.js and release.js, so the artefact
// contract was written out four times and nothing checked the four agreed. config.js owns what
// the build *is* — version, origin, the git stamp; this owns where it goes.

const DIST = 'dist';
const BUNDLE = 'dist/userScript.js';
const BOOT_BUNDLE = 'dist/bootScreen.js';

const SERVICE_DIST = 'service/dist';
const SERVICE_BUNDLE = 'service/dist/index.js';
const SERVICE_DIST_LEGACY = 'service/dist-legacy';
const SERVICE_BUNDLE_LEGACY = 'service/dist-legacy/index.js';

const RELEASE = 'release';
// Named for the oldest Tizen each installs on.
const WGT = 'release/tube-tizen-6.5.wgt';
const WGT_LEGACY = 'release/tube-tizen-5.0.wgt';

// app/ is a source directory, not an archive path. Tizen resolves <content src> and <icon src>
// relative to the archive root, and service/lib/cobalt.js reads ../../config.xml at runtime from
// service/dist/, so config.xml has to arrive at the top of the widget however it is filed here.
const WIDGET = [
    { from: 'app/config.xml', to: 'config.xml' },
    { from: 'app/icon.png', to: 'icon.png' },
    { from: 'app/index.html', to: 'index.html' },
    { from: 'service/dist', to: 'service/dist' }
];

// Staged at service/dist, where config.xml points for both widgets.
const WIDGET_LEGACY = WIDGET.map((entry) => (entry.from === SERVICE_DIST
    ? { from: SERVICE_DIST_LEGACY, to: entry.to }
    : entry));

const ARTEFACTS = [DIST, SERVICE_DIST, SERVICE_DIST_LEGACY, RELEASE];

module.exports = {
    DIST, BUNDLE, BOOT_BUNDLE,
    SERVICE_DIST, SERVICE_BUNDLE, SERVICE_DIST_LEGACY, SERVICE_BUNDLE_LEGACY,
    RELEASE, WGT, WGT_LEGACY,
    WIDGET, WIDGET_LEGACY, ARTEFACTS
};
