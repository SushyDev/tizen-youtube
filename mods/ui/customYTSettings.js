import { SettingActionRenderer, SettingsCategory } from './ytUI.js';

// The way into this app's settings, planted at the top of YouTube's own settings page
// as its own category. Someone who has never heard of a modification finds a row
// called "Additional options" that behaves like every other row on the page.

function PatchSettings(settingsObject) {
    const openSettings = SettingActionRenderer(
        'Additional options',
        'tube_open_settings',
        {
            customAction: {
                action: 'OPEN_ADDITIONAL_OPTIONS',
                parameters: []
            }
        },
        'Ad blocking, SponsorBlock, playback and interface',
        'https://www.gstatic.com/ytlr/img/parent_code.png'
    );

    settingsObject.items.unshift(SettingsCategory('tube_settings', [openSettings]));
}

export {
    PatchSettings
}
