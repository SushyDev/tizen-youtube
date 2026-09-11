'use strict';

// Reads the container switches from this package's config.xml; never writes them.

const fs = require('fs');
const path = require('path');

// The nativeID this package claims, which is also the app id the launched container runs under.
const CONTAINER = 'com.samsung.tv.cobalt-yt';

// Correct inside the widget, where lib/ sits two levels under the archive root.
const CONFIG = path.join(__dirname, '..', '..', 'config.xml');

// Read once and remembered, including the failure: off the set there is no config.xml, and
// retrying the same missing file on every question would be a stat per call.
const state = { config: undefined };

const config = () => {
    if (state.config === undefined) {
        try {
            state.config = fs.readFileSync(CONFIG, 'utf8');
        } catch (e) {
            state.config = null;
        }
    }

    return state.config;
};

// Our own switches, so the staging lands where --content says rather than by convention.
const switches = () => {
    const found = /native\.userdata"\s+value="([^"]*)"/.exec(config() || '');
    return found ? found[1].replace(/&quot;/g, '"') : null;
};

const configuredContent = () => {
    if (process.env.TUBE_COBALT_CONTENT) return process.env.TUBE_COBALT_CONTENT;

    const found = /--content=(\S+)/.exec(switches() || '');
    return found ? found[1] : null;
};

// The container slot this package claims, or null when it claims none.
const container = () => {
    if (config() === null) return null;

    return /--content=|--base_url=/.test(switches() || '') ? CONTAINER : null;
};

const appId = () => {
    const found = /<tizen:application\s+id="([^"]+)"/.exec(config() || '');
    return found ? found[1] : null;
};

module.exports = { CONTAINER, config, switches, configuredContent, container, appId };
