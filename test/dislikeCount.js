import assert from 'assert';

const storage = { data: {} };

global.window = {
    localStorage: {
        'tube.settings': '{}',
        getItem: (key) => (Object.prototype.hasOwnProperty.call(storage.data, key) ? storage.data[key] : null),
        setItem: (key, value) => { storage.data[key] = String(value); }
    },
    addEventListener: () => undefined
};
global.window.JSON = JSON;
global.location = { hash: '#/' };

const answers = { body: null, calls: [] };

global.fetch = (url) => {
    answers.calls.push(url);
    return Promise.resolve({ json: () => Promise.resolve(answers.body) });
};

const { configRead, configWrite } = await import('../framework/config.js');
const { compact } = await import('../mods/dislike/api.js');
const { dislikesOf, remember } = await import('../mods/dislike/store.js');
const { checkVideo } = await import('../mods/dislike/count.js');

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

const checkAsync = async (name, run) => {
    try {
        await run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 6).join('\n      ')}`);
    }
};

const withConfigAsync = async (settings, run) => {
    const before = Object.keys(settings).map((key) => [key, configRead(key)]);
    Object.keys(settings).forEach((key) => configWrite(key, settings[key]));
    try {
        await run();
    } finally {
        before.forEach((entry) => configWrite(entry[0], entry[1]));
    }
};

const settled = (ms) => new Promise((done) => setTimeout(done, ms));

check('a compact count rounds down the same way YouTube\'s own like count does', () => {
    assert.strictEqual(compact(79571), '79K', '79,571 should read as 79K, not 80K');
    assert.strictEqual(compact(999), '999');
    assert.strictEqual(compact(1234567), '1.2M');
    assert.strictEqual(compact(0), '0');
});

check('a video never remembered reads as unknown', () => {
    assert.strictEqual(dislikesOf('never-seen-dislike'), undefined);
});

check('a remembered count reads back as itself', () => {
    remember('remembered-dislike', 4213);
    assert.strictEqual(dislikesOf('remembered-dislike'), 4213);
});

const suite = async () => {
    await checkAsync('a video seen for the first time is asked about, once', async () => {
        answers.body = { likes: 79570, dislikes: 3120, rating: null, viewCount: 500000, deleted: false };
        answers.calls = [];

        await withConfigAsync({ enableReturnDislike: true }, async () => {
            checkVideo('#/watch?v=neverSeenDislike');
            checkVideo('#/watch?v=neverSeenDislike');
            checkVideo('#/watch?v=neverSeenDislike');

            assert.strictEqual(answers.calls.length, 1, `asked ${answers.calls.length} times`);

            assert.strictEqual(dislikesOf('neverSeenDislike'), undefined,
                'the answer cannot have arrived yet');

            await settled(20);
            assert.strictEqual(dislikesOf('neverSeenDislike'), 3120);
        });
    });

    await checkAsync('a hash with no video id asks nothing', async () => {
        answers.calls = [];

        await withConfigAsync({ enableReturnDislike: true }, async () => {
            checkVideo('#/browse?c=FEsubscriptions');
            assert.strictEqual(answers.calls.length, 0);
        });
    });

    await checkAsync('a video whose answer is a traceId error is not remembered, and is asked again later', async () => {
        answers.body = { traceId: 'abc123' };
        answers.calls = [];

        await withConfigAsync({ enableReturnDislike: true }, async () => {
            checkVideo('#/watch?v=erroredDislike');
            await settled(20);
            assert.strictEqual(dislikesOf('erroredDislike'), undefined,
                'an error response was cached as though it were a real answer');

            answers.calls = [];
            checkVideo('#/watch?v=erroredDislike');
            assert.strictEqual(answers.calls.length, 1);
        });
    });

    await checkAsync('the setting off asks nothing', async () => {
        answers.calls = [];

        await withConfigAsync({ enableReturnDislike: false }, async () => {
            checkVideo('#/watch?v=settingOffDislike');
            assert.strictEqual(answers.calls.length, 0);
        });
    });

    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
};

await suite();
