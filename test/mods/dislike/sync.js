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

const puzzleFor = () => ({ challenge: encodeBase64(crypto.getRandomValues(new Uint8Array(16))), difficulty: DIFFICULTY });

const json = (body, status) => Promise.resolve({
    ok: !status || (status >= 200 && status < 300),
    status: status || 200,
    json: () => Promise.resolve(body)
});

const server = { registered: {}, votes: [], inFlightValue: null, failNextVotes: 0, hold: null };

global.fetch = (url, options) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const userId = parsed.searchParams.get('userId');
    const body = options && options.body ? JSON.parse(options.body) : null;

    if (path === '/puzzle/registration' && (!options || options.method === undefined)) return json(puzzleFor());
    if (path === '/puzzle/registration' && options.method === 'POST') {
        server.registered[userId] = true;
        return json(true);
    }
    if (path === '/interact/vote') {
        if (server.failNextVotes > 0) {
            server.failNextVotes -= 1;
            return Promise.reject(new Error('simulated network failure'));
        }
        if (!server.registered[body.userId]) return json(null, 401);
        server.inFlightValue = body.value;

        if (server.hold) {
            return new Promise((resolve) => { server.hold = () => resolve(json(puzzleFor())); });
        }
        return json(puzzleFor());
    }
    if (path === '/interact/confirmVote') {
        if (!server.registered[body.userId]) return json(null, 401);
        server.votes.push({ videoId: body.videoId, value: server.inFlightValue });
        return json(true);
    }

    return Promise.reject(new Error(`unexpected fetch: ${path}`));
};

// At most one timer per video (debounce or retry backoff), but different videos each get their own.
const realSetTimeout = global.setTimeout;

const fakeTimers = () => {
    const pending = new Map();
    const held = { nextId: 1 };

    global.setTimeout = (fn, delay) => {
        const id = held.nextId++;
        pending.set(id, { fn, delay });
        return id;
    };
    global.clearTimeout = (id) => { pending.delete(id); };

    // crypto.subtle.digest resolves via Node's libuv threadpool, so only real event-loop turns free it.
    const flush = async () => {
        await Array.from({ length: 60 }).reduce(
            (chain) => chain.then(() => new Promise((resolve) => realSetTimeout(resolve, 0))),
            Promise.resolve()
        );
    };

    return {
        count: () => pending.size,
        delays: () => Array.from(pending.values()).map((entry) => entry.delay),
        fireAll: async () => {
            const due = Array.from(pending.entries());
            pending.clear();
            due.forEach(([, entry]) => entry.fn());
            await flush();
        },
        flush
    };
};

const { dislikesOf, remember } = await import('../../../mods/dislike/store.js');
const { requestVote } = await import('../../../mods/dislike/sync.js');

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
    await checkAsync('the optimistic count updates immediately, with no timer needed', async () => {
        const timers = fakeTimers();
        remember('videoAaaaaaa', 100);

        requestVote('videoAaaaaaa', -1);
        assert.strictEqual(dislikesOf('videoAaaaaaa'), 101, 'a fresh dislike should show up right away');
        assert.ok(timers.count() >= 1, 'a debounce timer should be pending, nothing fired yet');
        assert.deepStrictEqual(server.votes, [], 'nothing should have reached the server synchronously');
    });

    await checkAsync('repeated toggles before the debounce fires do not compound, or pile up timers', async () => {
        const timers = fakeTimers();
        remember('videoBbbbbbb', 200);

        requestVote('videoBbbbbbb', -1);
        const afterFirstPress = timers.count();

        requestVote('videoBbbbbbb', 0);
        requestVote('videoBbbbbbb', -1);
        requestVote('videoBbbbbbb', 0);

        assert.strictEqual(dislikesOf('videoBbbbbbb'), 200, 'four toggles back to neutral should net to no change');
        assert.strictEqual(timers.count(), afterFirstPress, 'each press replaces the pending debounce rather than adding another');
    });

    await checkAsync('a burst of presses reaches the server exactly once, for the final value', async () => {
        const timers = fakeTimers();
        server.votes = [];

        requestVote('videoCcccccc', -1);
        requestVote('videoCcccccc', 0);
        requestVote('videoCcccccc', -1);

        await timers.fireAll();
        await timers.flush();

        assert.strictEqual(server.votes.length, 1, `expected exactly one vote to reach the server, got ${server.votes.length}`);
        assert.strictEqual(server.votes[0].value, -1);
    });

    await checkAsync('a value that changes mid-flight is chased, not queued behind the stale one', async () => {
        const timers = fakeTimers();
        server.votes = [];
        server.hold = true;

        requestVote('videoDddddddd'.slice(0, 11), -1);
        await timers.fireAll(); // debounce fires, submission starts and blocks on server.hold

        requestVote('videoDddddddd'.slice(0, 11), 0); // the viewer changes their mind while it's in flight
        assert.strictEqual(timers.count(), 1, 'the new value still waits out its own debounce');
        await timers.fireAll(); // that debounce firing is a no-op: a submission is already in flight

        const release = server.hold;
        server.hold = null;
        release();
        await timers.flush();
        await timers.flush(); // the immediate re-chase for the corrected value needs its own turns too

        // The stale in-flight attempt can't be recalled, so it lands, but the next chase picks up `desired` at once.
        assert.strictEqual(server.votes.length, 2, `expected the stale value plus the corrected one, got ${server.votes.length}`);
        assert.strictEqual(server.votes[0].value, -1, 'the in-flight one could not be recalled');
        assert.strictEqual(server.votes[server.votes.length - 1].value, 0, 'but the server ends up with the real final value');
    });

    await checkAsync('a failed submission retries and eventually lands', async () => {
        const timers = fakeTimers();
        server.votes = [];
        server.failNextVotes = 2;

        requestVote('videoEeeeeee'.slice(0, 11), 1);
        await timers.fireAll(); // debounce -> first attempt, fails
        assert.strictEqual(server.votes.length, 0);
        assert.strictEqual(timers.count(), 1, 'a retry should be scheduled after a failure');

        await timers.fireAll(); // retry -> fails again
        assert.strictEqual(server.votes.length, 0);
        assert.ok(timers.count() >= 1, 'another retry should be scheduled');

        await timers.fireAll(); // retry -> succeeds
        assert.strictEqual(server.votes.length, 1);
        assert.strictEqual(server.votes[0].value, 1);
    });

    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
};

await suite();
