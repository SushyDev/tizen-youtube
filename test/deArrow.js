// DeArrow.
//
// Three separate faults, all confirmed on the set before these were written:
//
//   1. Nothing was dressed on a fresh launch. The answer arrives from the network, but a tile is
//      dressed inside JSON.parse and cannot be waited for, so the old code dressed from a .then()
//      after the app had already taken the title. Running one fixture through the patched parse on
//      the television gave the original title on the first pass and the DeArrow title on the
//      second — it only ever worked when a video came round twice in one session.
//   2. No thumbnail was ever substituted. Picking the highest-voted entry picks the *original*
//      thumbnail on a popular video, and an original carries `timestamp: null`. Live for
//      dQw4w9WgXcQ: locked=true has 2 votes, original=true has 9.
//   3. Even when one was, hqify replaced it. It is registered after deArrow and rebuilt the
//      thumbnails array unconditionally, so the substitution was thrown away every time.

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
const { SHELF, walkTiles } = await import('../framework/feed.js');
const { bestOf } = await import('../mods/feed/brandingApi.js');
await import('../mods/feed/index.js');

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

const withConfig = (settings, run) => {
    const before = Object.keys(settings).map((key) => [key, configRead(key)]);
    Object.keys(settings).forEach((key) => configWrite(key, settings[key]));
    try {
        return run();
    } finally {
        before.forEach((entry) => configWrite(entry[0], entry[1]));
    }
};

// The async twin. withConfig's `finally` fires the moment an async run() hands back its promise,
// which would put every setting back before the awaited half of the test had run.
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

const tile = (videoID, thumbUrl) => ({
    tileRenderer: {
        contentId: videoID,
        style: 'TILE_STYLE_YTLR_DEFAULT',
        metadata: { tileMetadataRenderer: { title: { simpleText: `original ${videoID}` } } },
        header: {
            tileHeaderRenderer: {
                thumbnail: {
                    thumbnails: [{ url: thumbUrl || `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg` }]
                }
            }
        },
        onSelectCommand: { watchEndpoint: { videoId: videoID } }
    }
});

const dressed = (items) => walkTiles(items, SHELF)[0].tileRenderer;

// -- which answer to believe ------------------------------------------------------------------

// The live shape for dQw4w9WgXcQ, read off sponsor.ajay.app.
const RICK = {
    titles: [
        { title: 'Rick Astley - Never gonna give you up (official music video)', votes: 1, locked: true, original: false },
        { title: 'The video is unavailable', votes: 0, locked: false, original: false }
    ],
    thumbnails: [
        { timestamp: 3.92349, votes: 2, locked: true, original: false },
        { timestamp: null, votes: 9, locked: false, original: true },
        { timestamp: 3.742979, votes: 6, locked: false, original: false },
        { timestamp: 0, votes: 1, locked: false, original: false }
    ]
};

check('a locked entry beats a higher-voted unlocked one, as it does in DeArrow itself', () => {
    assert.strictEqual(bestOf(RICK).timestamp, 3.92349,
        'votes alone picked the original thumbnail, whose timestamp is null');
    assert.strictEqual(bestOf(RICK).title, 'Rick Astley - Never gonna give you up (official music video)');
});

check('the original is never a substitution', () => {
    const onlyOriginal = { titles: [], thumbnails: [{ timestamp: null, votes: 99, locked: false, original: true }] };
    assert.deepStrictEqual(bestOf(onlyOriginal), { title: null, timestamp: null });
});

check('a downvoted submission is not shown', () => {
    const buried = {
        titles: [{ title: 'nonsense', votes: -2, locked: false, original: false }],
        thumbnails: []
    };
    assert.strictEqual(bestOf(buried).title, null);
});

check('timestamp zero is a real frame, not an absent one', () => {
    const atZero = { titles: [], thumbnails: [{ timestamp: 0, votes: 1, locked: false, original: false }] };
    assert.strictEqual(bestOf(atZero).timestamp, 0);
});

check('nothing submitted is nothing to say', () => {
    assert.deepStrictEqual(bestOf({ titles: [], thumbnails: [] }), { title: null, timestamp: null });
});

// -- hqify must not throw the substitution away -------------------------------------------------

check("YouTube's own thumbnail is still enlarged", () => {
    withConfig({ enableHqThumbnails: true, enableDeArrow: false }, () => {
        const url = dressed([tile('abc')]).header.tileHeaderRenderer.thumbnail.thumbnails[0].url;
        assert.strictEqual(url, 'https://i.ytimg.com/vi/abc/sddefault.jpg');
    });
});

check("a thumbnail that is not YouTube's is left exactly as it is", () => {
    withConfig({ enableHqThumbnails: true, enableDeArrow: false }, () => {
        const theirs = 'https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=abc&time=3.9';
        const url = dressed([tile('abc', theirs)]).header.tileHeaderRenderer.thumbnail.thumbnails[0].url;
        assert.strictEqual(url, theirs, 'hqify rebuilt the array and threw the substitution away');
    });
});

// -- the store is what dresses ------------------------------------------------------------------

const suite = async () => {
    await checkAsync('a video never seen before is asked about and dressed by the next response', async () => {
        answers.body = RICK;
        answers.calls = [];

        await withConfigAsync({ enableDeArrow: true, enableDeArrowThumbnails: true, enableHqThumbnails: true }, async () => {
            const first = dressed([tile('rick')]);
            assert.strictEqual(first.metadata.tileMetadataRenderer.title.simpleText, 'original rick',
                'the answer cannot have arrived yet — dressing here is dressing after the render');
            assert.strictEqual(answers.calls.length, 1);

            await settled(20);

            const second = dressed([tile('rick')]);
            assert.strictEqual(second.metadata.tileMetadataRenderer.title.simpleText,
                'Rick Astley - Never gonna give you up (official music video)');
            assert.strictEqual(second.header.tileHeaderRenderer.thumbnail.thumbnails[0].url,
                'https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=rick&time=3.92349',
                'the substitution was overwritten again');
        });
    });

    await checkAsync('one video carried by many shelves is asked about once', async () => {
        answers.body = RICK;
        answers.calls = [];

        await withConfigAsync({ enableDeArrow: true }, async () => {
            walkTiles([tile('twice'), tile('twice'), tile('twice')], SHELF);
            assert.strictEqual(answers.calls.length, 1, `asked ${answers.calls.length} times`);
            await settled(20);
        });
    });

    await checkAsync('a video DeArrow has nothing for is asked about once and then left alone', async () => {
        answers.body = { titles: [], thumbnails: [] };
        answers.calls = [];

        await withConfigAsync({ enableDeArrow: true }, async () => {
            dressed([tile('bare')]);
            await settled(20);

            const again = dressed([tile('bare')]);
            assert.strictEqual(again.metadata.tileMetadataRenderer.title.simpleText, 'original bare');
            assert.strictEqual(answers.calls.length, 1, 'it was asked about again on the next scroll');
        });
    });

    // The whole point of the store: this is what a relaunch looks like.
    await checkAsync('what DeArrow said survives a restart, so the first feed of a session lands', async () => {
        answers.body = RICK;

        await withConfigAsync({ enableDeArrow: true }, async () => {
            dressed([tile('kept')]);
            await settled(400);
        });

        assert.ok(storage.data['tube.dearrow'], 'nothing was written to storage at all');

        // A fresh module graph reading the same storage is a fresh launch.
        const reloaded = await import('../mods/feed/brandingStore.js?relaunch=1');

        assert.deepStrictEqual(reloaded.brandingOf('kept'),
            { title: 'Rick Astley - Never gonna give you up (official music video)', timestamp: 3.92349 });
        assert.strictEqual(reloaded.brandingOf('never-seen'), undefined,
            'a video not in the store must read as unknown, not as nothing-to-say');
    });

    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
};

await suite();
