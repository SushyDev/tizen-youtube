import assert from 'assert';

global.window = { localStorage: { 'tube.settings': '{}' }, addEventListener: () => undefined };

const { start } = await import('../../mods/shell/voiceCapability.js');

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

// tectonicConfig is built from /tv_config, fetched after kabuki's own script — so it is absent
// when the mod starts, and the override has to survive its arrival.
const freshWindow = () => { delete global.window.tectonicConfig; };

check('kabuki’s own bypass switch is answered true for switches that arrive after start', () => {
    freshWindow();
    start();
    global.window.tectonicConfig = { featureSwitches: { forceVoiceEnabled: false } };

    assert.strictEqual(global.window.tectonicConfig.featureSwitches.forceVoiceEnabled, true);
});

// The app replaces the whole object when it overrides a switch of its own.
check('the answer survives the switches being replaced wholesale', () => {
    freshWindow();
    start();
    global.window.tectonicConfig = { featureSwitches: { forceVoiceEnabled: false } };
    global.window.tectonicConfig.featureSwitches = { forceVoiceEnabled: false, other: 1 };

    const { featureSwitches } = global.window.tectonicConfig;
    assert.strictEqual(featureSwitches.forceVoiceEnabled, true);
    assert.strictEqual(featureSwitches.other, 1, 'the switches beside it are left alone');
});

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
