'use strict';

const DIST = 'dist';
const BUNDLE = 'dist/userScript.js';
const BOOT_BUNDLE = 'dist/bootScreen.js';

const SERVICE_DIST = 'service/dist';
const SERVICE_BUNDLE = 'service/dist/index.js';
const SERVICE_DIST_LEGACY = 'service/dist-legacy';
const SERVICE_BUNDLE_LEGACY = 'service/dist-legacy/index.js';

const RELEASE = 'release';
// Named for the oldest Tizen each installs on.
const WGT = 'release/tube-tizen-5.5.wgt';
const WGT_LEGACY = 'release/tube-tizen-5.0.wgt';

// Tizen resolves <content src> and <icon src> against the archive root, and service/lib/cobalt.js
// reads ../../config.xml from service/dist/, so config.xml must land at the top of the widget.
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
