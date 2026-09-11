// Player buttons, dressed in the transport-controls response.

import assert from 'assert';

global.window = { localStorage: { 'tube.settings': '{}' }, addEventListener: () => undefined };
global.window.JSON = JSON;

const { configRead, configWrite } = await import('../framework/config.js');
const { interceptJson } = await import('../framework/json.js');
await import('../mods/player/playerButtons.js');

interceptJson();

const results = [];

const check = (name, run) => {
    try {
        run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 6).join('\n      ')}`);
    }
};

const withConfig = (settings, run) => {
    const before = Object.keys(settings).map((key) => [key, configRead(key)]);
    Object.keys(settings).forEach((key) => configWrite(key, settings[key]));
    try {
        run();
    } finally {
        before.forEach((entry) => configWrite(entry[0], entry[1]));
    }
};

const button = (name) => ({ type: `TRANSPORT_CONTROLS_BUTTON_TYPE_${name}`, button: { buttonRenderer: {} } });

const response = () => JSON.parse(JSON.stringify({
    transportControls: {
        transportControlsRenderer: {
            skipPreviousButton: { buttonRenderer: { text: 'theirs' } },
            skipNextButton: { buttonRenderer: { text: 'theirs' } },
            engagementActions: [
                button('LIKE_BUTTON'), button('COMMENTS'), button('ADD_TO_PLAYLIST'),
                button('SUPER_THANKS'), button('SHOPPING'), button('YOUCHAT_BUTTON')
            ],
            settingActions: [
                button('CAPTIONS'), button('PLAYBACK_SETTINGS'), button('QUALITY'), button('SPEED_BUTTON')
            ]
        }
    }
}));

const typesIn = (controls, group) => (controls[group] || [])
    .map((a) => a.type.replace('TRANSPORT_CONTROLS_BUTTON_TYPE_', ''));

const dressed = () => response().transportControls.transportControlsRenderer;

check('the mini player goes in before playback settings', () => {
    withConfig({ enableMPButton: true }, () => {
        const types = typesIn(dressed(), 'settingActions');
        assert.deepStrictEqual(types, ['CAPTIONS', 'PIP', 'PLAYBACK_SETTINGS', 'QUALITY', 'SPEED_BUTTON']);
    });
});

check('and is left out when it is not wanted', () => {
    withConfig({ enableMPButton: false }, () => {
        assert.strictEqual(typesIn(dressed(), 'settingActions').indexOf('PIP'), -1);
    });
});

check('the mini player is never added twice', () => {
    withConfig({ enableMPButton: true }, () => {
        const twice = JSON.parse(JSON.stringify(response())).transportControls.transportControlsRenderer;
        const types = typesIn(twice, 'settingActions').filter((t) => t === 'PIP');
        assert.strictEqual(types.length, 1);
    });
});

check('no speed button is added', () => {
    withConfig({ enableMPButton: true }, () => {
        const types = typesIn(dressed(), 'settingActions');
        assert.strictEqual(types.filter((t) => t.indexOf('SPEED') !== -1).length, 1,
            'a second speed control was added beside the one the container sends');
    });
});

check('the buttons a viewer turned off are taken out', () => {
    withConfig({ enableSuperThanksButton: false, hideShoppingAction: true, enableAIAskButton: false }, () => {
        assert.deepStrictEqual(typesIn(dressed(), 'engagementActions'),
            ['LIKE_BUTTON', 'COMMENTS', 'ADD_TO_PLAYLIST']);
    });
});

check('and left alone when they are wanted', () => {
    withConfig({ enableSuperThanksButton: true, hideShoppingAction: false, enableAIAskButton: true }, () => {
        assert.deepStrictEqual(typesIn(dressed(), 'engagementActions'),
            ['LIKE_BUTTON', 'COMMENTS', 'ADD_TO_PLAYLIST', 'SUPER_THANKS', 'SHOPPING', 'YOUCHAT_BUTTON']);
    });
});

check('previous and next become queue controls', () => {
    withConfig({ enablePreviousNextButtons: true }, () => {
        const controls = dressed();
        assert.strictEqual(controls.skipPreviousButton.buttonRenderer.command.signalAction.signal, 'PLAYER_PLAY_PREVIOUS');
        assert.strictEqual(controls.skipNextButton.buttonRenderer.command.signalAction.signal, 'PLAYER_PLAY_NEXT');
    });
});

check('and are left as YouTube sent them otherwise', () => {
    withConfig({ enablePreviousNextButtons: false }, () => {
        assert.strictEqual(dressed().skipPreviousButton.buttonRenderer.text, 'theirs');
    });
});

check('a response with no transport controls is untouched', () => {
    const out = JSON.parse(JSON.stringify({ transportControls: { somethingElse: 1 } }));
    assert.deepStrictEqual(out, { transportControls: { somethingElse: 1 } });
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
