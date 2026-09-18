// Counter + challenge must SHA-512 to `difficulty` leading zero bits, in the reference client's exact byte layout.

const decodeBase64 = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const encodeBase64 = (bytes) => btoa(String.fromCharCode(...bytes));

const leadingZeroBits = (bytes) => {
    const atIndex = (index) => {
        if (index >= bytes.length) return 0;
        const byte = bytes[index];
        return byte === 0 ? 8 + atIndex(index + 1) : Math.clz32(byte) - 24;
    };

    return atIndex(0);
};

const attempt = async (buffer, counterView, difficulty, counter, attemptsLeft) => {
    if (attemptsLeft <= 0) return null;

    counterView[0] = counter;
    const hash = await crypto.subtle.digest('SHA-512', buffer);
    if (leadingZeroBits(new Uint8Array(hash)) >= difficulty) {
        return { solution: encodeBase64(new Uint8Array(buffer).slice(0, 4)) };
    }

    return attempt(buffer, counterView, difficulty, counter + 1, attemptsLeft - 1);
};

// Defaults to 3x the expected attempts needed to clear the difficulty, for comfortable odds without an unbounded search.
const solvePuzzle = (puzzle, maxAttempts) => {
    const challenge = decodeBase64(puzzle.challenge);
    const buffer = new ArrayBuffer(20);
    const counterView = new Uint32Array(buffer);
    new Uint8Array(buffer).set(challenge, 4);

    const attempts = maxAttempts || 2 ** puzzle.difficulty * 3;
    return attempt(buffer, counterView, puzzle.difficulty, 0, attempts);
};

export { leadingZeroBits, solvePuzzle };
