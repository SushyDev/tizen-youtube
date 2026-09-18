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

// withConfig's `finally` would put every setting back before the awaited half of the test had run.
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

check('a locked entry beats a higher-voted unlocked one', () => {
    assert.strictEqual(bestOf(RICK).timestamp, 3.92349,
        'votes alone picked the original thumbnail, whose timestamp is null');
    assert.strictEqual(bestOf(RICK).title, 'Rick Astley - Never gonna give you up (official music video)');
});

check('the original is never a substitution', () => {
    const onlyOriginal = { titles: [], thumbnails: [{ timestamp: null, votes: 99, locked: false, original: true }] };
    assert.deepStrictEqual(bestOf(onlyOriginal), { title: null, timestamp: null });
});

check('when the top pick is the original, a lesser entry behind it is not shown instead', () => {
    // The server's own order says "keep the original" beat this custom thumbnail on votes; the
    // old bug filtered the original out of contention and showed the runner-up instead.
    const topIsOriginal = {
        titles: [],
        thumbnails: [
            { timestamp: null, votes: 50, locked: false, original: true },
            { timestamp: 5, votes: 10, locked: false, original: false }
        ]
    };
    assert.deepStrictEqual(bestOf(topIsOriginal), { title: null, timestamp: null });
});

check('a locked entry is never rejected for its vote count', () => {
    const lockedButBuried = { titles: [{ title: 'locked title', votes: -5, locked: true, original: false }], thumbnails: [] };
    assert.strictEqual(bestOf(lockedButBuried).title, 'locked title');
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

const suite = async () => {
    await checkAsync('a video never seen before is asked about and dressed by the next response', async () => {
        answers.body = { rick: RICK };
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
        answers.body = { twice: RICK };
        answers.calls = [];

        await withConfigAsync({ enableDeArrow: true }, async () => {
            walkTiles([tile('twice'), tile('twice'), tile('twice')], SHELF);
            assert.strictEqual(answers.calls.length, 1, `asked ${answers.calls.length} times`);
            await settled(20);
        });
    });

    await checkAsync('a video DeArrow has nothing for is asked about once and then left alone', async () => {
        answers.body = {};
        answers.calls = [];

        await withConfigAsync({ enableDeArrow: true }, async () => {
            dressed([tile('bare')]);
            await settled(20);

            const again = dressed([tile('bare')]);
            assert.strictEqual(again.metadata.tileMetadataRenderer.title.simpleText, 'original bare');
            assert.strictEqual(answers.calls.length, 1, 'it was asked about again on the next scroll');
        });
    });

    await checkAsync('what DeArrow said survives a restart', async () => {
        answers.body = { kept: RICK };

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

    await checkAsync('the video id is never sent to the branding endpoint, only four characters of its hash', async () => {
        answers.body = {};
        answers.calls = [];

        await withConfigAsync({ enableDeArrow: true }, async () => {
            dressed([tile('hashcheck1')]);
            await settled(20);
        });

        assert.strictEqual(answers.calls.length, 1);
        assert.strictEqual(answers.calls[0].indexOf('hashcheck1'), -1,
            `the id itself went to the server: ${answers.calls[0]}`);

        const hash = answers.calls[0].split('/api/branding/')[1];
        assert.strictEqual(hash.length, 4, `expected a four-character prefix, got ${hash}`);
    });

    await checkAsync('the answer covers every id sharing that prefix, and ours is picked out', async () => {
        answers.body = {
            someoneElse: { titles: [{ title: 'not ours', votes: 5, locked: false, original: false }], thumbnails: [] },
            hashcheck2: { titles: [{ title: 'ours', votes: 1, locked: false, original: false }], thumbnails: [] }
        };
        answers.calls = [];

        await withConfigAsync({ enableDeArrow: true }, async () => {
            dressed([tile('hashcheck2')]);
            await settled(20);

            const again = dressed([tile('hashcheck2')]);
            assert.strictEqual(again.metadata.tileMetadataRenderer.title.simpleText, 'ours');
        });
    });

    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
};

await suite();
