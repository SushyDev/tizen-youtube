'use strict';

const fs = require('fs');
const path = require('path');

// Correct inside the widget, where lib/ sits two levels under the archive root.
const CONFIG = path.join(__dirname, '..', '..', 'config.xml');

// Stock YouTube's slot, for when there is no config.xml to name one.
const DEFAULT_SLOT = 'com.samsung.tv.cobalt-yt';

// The failure is remembered too, because off the set there is no config.xml and every question
// would then cost a stat.
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

// The nativeID this package claims, which is also the app id the launched container runs under.
const claimed = /nativeID"\s+value="([^"]+)"/.exec(config() || '');
const CONTAINER = claimed ? claimed[1] : DEFAULT_SLOT;

const switches = () => {
    const found = /native\.userdata"\s+value="([^"]*)"/.exec(config() || '');
    return found ? found[1].replace(/&quot;/g, '"') : null;
};

const configuredContent = () => {
    if (process.env.TUBE_COBALT_CONTENT) return process.env.TUBE_COBALT_CONTENT;

    const found = /--content=(\S+)/.exec(switches() || '');
    return found ? found[1] : null;
};

const container = () => {
    if (config() === null) return null;

    return /--content=|--base_url=/.test(switches() || '') ? CONTAINER : null;
};

const appId = () => {
    const found = /<tizen:application\s+id="([^"]+)"/.exec(config() || '');
    return found ? found[1] : null;
};

const appVersion = () => {
    const found = /<widget[^>]+version="([^"]+)"/.exec(config() || '');
    return found ? found[1] : null;
};

module.exports = { CONTAINER, config, switches, configuredContent, container, appId, appVersion };
