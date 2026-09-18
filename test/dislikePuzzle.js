import assert from 'assert';

const { leadingZeroBits, solvePuzzle } = await import('../mods/dislike/puzzle.js');

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

check('a byte array starting with a fully-zero byte counts a full 8 for it', () => {
    assert.strictEqual(leadingZeroBits(new Uint8Array([0x00, 0xff])), 8);
});

check('a leading 0x0f byte contributes 4 leading zero bits', () => {
    assert.strictEqual(leadingZeroBits(new Uint8Array([0x0f, 0xff])), 4);
});

check('a leading 0x01 byte contributes 7 leading zero bits', () => {
    assert.strictEqual(leadingZeroBits(new Uint8Array([0x01])), 7);
});

check('a leading non-zero high bit contributes zero', () => {
    assert.strictEqual(leadingZeroBits(new Uint8Array([0x80, 0x00])), 0);
});

check('two fully-zero bytes followed by a partial one add across the boundary', () => {
    assert.strictEqual(leadingZeroBits(new Uint8Array([0x00, 0x00, 0x0f])), 20);
});

check('an all-zero array counts every bit', () => {
    assert.strictEqual(leadingZeroBits(new Uint8Array([0x00, 0x00])), 16);
});

const encodeBase64 = (bytes) => Buffer.from(bytes).toString('base64');
const decodeBase64 = (value) => new Uint8Array(Buffer.from(value, 'base64'));

const rehash = async (solution, challenge) => {
    const buffer = new ArrayBuffer(20);
    new Uint8Array(buffer).set(decodeBase64(solution), 0);
    new Uint8Array(buffer).set(challenge, 4);
    return new Uint8Array(await crypto.subtle.digest('SHA-512', buffer));
};

const suite = async () => {
    await checkAsync('a solved puzzle actually meets its own difficulty when rehashed', async () => {
        const challenge = crypto.getRandomValues(new Uint8Array(16));
        const puzzle = { challenge: encodeBase64(challenge), difficulty: 6 };

        // A generous budget, not the default (deliberately sometimes-insufficient) one, to avoid flaking.
        const solved = await solvePuzzle(puzzle, 5000);
        assert.ok(solved, 'a difficulty this low should always be solvable within budget');
        assert.strictEqual(typeof solved.solution, 'string');

        const hash = await rehash(solved.solution, challenge);
        assert.ok(leadingZeroBits(hash) >= puzzle.difficulty,
            `solution's hash only has ${leadingZeroBits(hash)} leading zero bits, needed ${puzzle.difficulty}`);
    });

    await checkAsync('a difficulty the attempt budget cannot reach is reported as unsolved, not thrown', async () => {
        const challenge = crypto.getRandomValues(new Uint8Array(16));
        const puzzle = { challenge: encodeBase64(challenge), difficulty: 24 };

        const solved = await solvePuzzle(puzzle, 2);
        assert.strictEqual(solved, null);
    });

    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
};

await suite();
