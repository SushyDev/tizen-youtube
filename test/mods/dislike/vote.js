import assert from 'assert';

const storage = { data: {} };

global.window = {
    localStorage: {
        getItem: (key) => (Object.prototype.hasOwnProperty.call(storage.data, key) ? storage.data[key] : null),
        setItem: (key, value) => { storage.data[key] = String(value); },
        removeItem: (key) => { delete storage.data[key]; }
    }
};

const encodeBase64 = (bytes) => Buffer.from(bytes).toString('base64');

// An easy puzzle so the real proof-of-work solver finishes quickly in tests.
const DIFFICULTY = 4;

const server = { registered: {}, votes: [], nextStatus: {} };

const puzzleFor = () => ({ challenge: encodeBase64(crypto.getRandomValues(new Uint8Array(16))), difficulty: DIFFICULTY });

const json = (body, status) => Promise.resolve({
    ok: !status || (status >= 200 && status < 300),
    status: status || 200,
    json: () => Promise.resolve(body)
});

global.fetch = (url, options) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const userId = parsed.searchParams.get('userId');
    const body = options && options.body ? JSON.parse(options.body) : null;

    if (path === '/puzzle/registration' && (!options || options.method === undefined)) {
        return json(puzzleFor());
    }
    if (path === '/puzzle/registration' && options.method === 'POST') {
        server.registered[userId] = true;
        return json(true);
    }
    if (path === '/interact/vote') {
        const forced = server.nextStatus.vote;
        delete server.nextStatus.vote;
        if (forced === 401) return json(null, 401);
        if (!server.registered[body.userId]) return json(null, 401);
        return json(puzzleFor());
    }
    if (path === '/interact/confirmVote') {
        const forced = server.nextStatus.confirmVote;
        delete server.nextStatus.confirmVote;
        if (forced === 401) return json(null, 401);
        if (!server.registered[body.userId]) return json(null, 401);
        server.votes.push({ userId: body.userId, videoId: body.videoId });
        return json(true);
    }

    return Promise.reject(new Error(`unexpected fetch: ${path}`));
};

const { credential } = await import('../../../mods/dislike/credential.js');
const { submitVote } = await import('../../../mods/dislike/vote.js');

const results = [];

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

const suite = async () => {
    await checkAsync('a vote registers a fresh credential and reaches the server confirmed', async () => {
        assert.strictEqual(credential(), null, 'no credential should exist yet');

        const ok = await submitVote('videoAaaaaaa', -1);
        assert.strictEqual(ok, true);

        const saved = credential();
        assert.ok(saved && saved.userId, 'a credential should now be persisted');
        assert.ok(server.registered[saved.userId], 'the persisted userId should be the one the server confirmed');
        assert.deepStrictEqual(server.votes[server.votes.length - 1], { userId: saved.userId, videoId: 'videoAaaaaaa' });
    });

    await checkAsync('a second vote reuses the already-registered credential, no new registration', async () => {
        const before = credential().userId;
        const registeredCountBefore = Object.keys(server.registered).length;

        await submitVote('videoBbbbbbb', 1);

        assert.strictEqual(credential().userId, before, 'the same credential should be reused');
        assert.strictEqual(Object.keys(server.registered).length, registeredCountBefore, 'no new registration should occur');
    });

    await checkAsync('a 401 on the vote step re-registers once and retries successfully', async () => {
        server.nextStatus.vote = 401;
        const staleUserId = credential().userId;

        const ok = await submitVote('videoDddddddd'.slice(0, 11), -1);
        assert.strictEqual(ok, true);

        const fresh = credential();
        assert.notStrictEqual(fresh.userId, staleUserId, 'a fresh credential should have replaced the stale one');
    });

    await checkAsync('a 401 on the confirm step re-registers once and retries successfully', async () => {
        server.nextStatus.confirmVote = 401;
        const staleUserId = credential().userId;

        const ok = await submitVote('videoEeeeeee'.slice(0, 11), 1);
        assert.strictEqual(ok, true);

        const fresh = credential();
        assert.notStrictEqual(fresh.userId, staleUserId);
    });

    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
};

await suite();
