global.window = { localStorage: { 'tube.settings': '{}' }, addEventListener: () => undefined };
global.window.JSON = JSON;
global.location = { hash: '#/' };
global.fetch = () => new Promise(() => { });

const { configRead, configWrite } = await import('../framework/config.js');

const results = [];

const check = (name, run) => {
    try {
        run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 5).join('\n      ')}`);
    }
};

const withConfig = (settings, run) => {
    const before = Object.keys(settings).map((key) => [key, configRead(key)]);
    Object.keys(settings).forEach((key) => configWrite(key, settings[key]));
    try {
        return run();
    } finally {
        before.forEach((entry) => configWrite(entry[0], entry[1]));
    }
};

const through = (response) => JSON.parse(JSON.stringify(response));

const finish = () => {
    console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
    process.exit(results.every(Boolean) ? 0 : 1);
};

export { check, withConfig, through, finish };
