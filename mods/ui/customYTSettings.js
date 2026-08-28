import { SettingActionRenderer, SettingsCategory } from './ytUI.js';

// The way into this app's settings, planted in YouTube's own settings page.
//
// It sits at the top as its own category, worded the way a television's own
// menu would word it. Someone who has never heard of a modification finds a
// row called "Additional options" and it behaves like every other row on
// that page — which is the whole idea.

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
