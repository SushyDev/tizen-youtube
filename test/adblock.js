// The playback-context rewrite follows enableAdBlock; its own file because it takes over JSON.

import assert from 'assert';

global.window = { localStorage: { 'tube.settings': '{}' }, addEventListener: () => undefined };
global.window.JSON = JSON;
global.location = { hash: '#/' };
global.fetch = () => new Promise(() => { });

const { configRead, configWrite } = await import('../framework/config.js');
const { interceptJson } = await import('../framework/json.js');
await import('../mods/feed/index.js');

interceptJson();

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
        run();
    } finally {
        before.forEach((entry) => configWrite(entry[0], entry[1]));
    }
};

const sent = () => JSON.parse(JSON.stringify({
    playbackContext: { contentPlaybackContext: { referer: 'x' } }
}));

check('with adverts blocked, the request claims an advert-free playback', () => {
    withConfig({ enableAdBlock: true }, () => {
        assert.strictEqual(sent().playbackContext.contentPlaybackContext.isInlinePlaybackNoAd, true);
    });
});

check('with adverts allowed, the request is left alone', () => {
    withConfig({ enableAdBlock: false }, () => {
        const body = sent().playbackContext.contentPlaybackContext;
        assert.strictEqual(body.isInlinePlaybackNoAd, undefined,
            'the suppression still went out, so the setting does nothing');
        assert.strictEqual(body.referer, 'x', 'the rest of the context was disturbed');
    });
});

check('a body carrying no playback context is untouched either way', () => {
    withConfig({ enableAdBlock: true }, () => {
        const out = JSON.parse(JSON.stringify({ somethingElse: 1 }));
        assert.deepStrictEqual(out, { somethingElse: 1 });
    });
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
