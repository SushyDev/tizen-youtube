// Submits a real vote to Return YouTube Dislike: register an anonymous credential if none is held
// yet, then run the vote/confirm handshake, each half gated behind its own proof-of-work puzzle.

import { credential, forget, generateUserId, remember } from './credential.js';
import { solvePuzzle } from './puzzle.js';

const API = 'https://returnyoutubedislikeapi.com';

const postJson = (path, body) => fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
});

const REGISTRATION_PUZZLE_ATTEMPTS = 2;

// Each attempt gets a fresh challenge — a failed solve is not a rejected puzzle, just an unlucky
// search within this one's attempt budget, so trying again with a new challenge is worth it.
const registerWith = async (userId, puzzleAttemptsLeft) => {
    if (puzzleAttemptsLeft <= 0) throw new Error('unable to solve the registration puzzle');

    const path = `/puzzle/registration?userId=${encodeURIComponent(userId)}`;

    const puzzleResponse = await fetch(`${API}${path}`, { headers: { Accept: 'application/json' } });
    if (!puzzleResponse.ok) throw new Error('registration puzzle request was rejected');

    const solved = await solvePuzzle(await puzzleResponse.json());
    if (!solved) return registerWith(userId, puzzleAttemptsLeft - 1);

    const confirmResponse = await postJson(path, solved);
    if (!confirmResponse.ok) throw new Error('registration confirmation was rejected');

    const confirmed = await confirmResponse.json();
    if (confirmed !== true) throw new Error('registration confirmation failed');

    remember(userId);
    return userId;
};

const registration = { inFlight: null };

const ensureRegistered = () => {
    const existing = credential();
    if (existing) return Promise.resolve(existing.userId);

    if (!registration.inFlight) {
        registration.inFlight = registerWith(generateUserId(), REGISTRATION_PUZZLE_ATTEMPTS)
            .finally(() => { registration.inFlight = null; });
    }
    return registration.inFlight;
};

const VOTE_PUZZLE_ATTEMPTS = 3;

const attemptVote = async (videoId, value, authRetriesLeft, puzzleAttemptsLeft) => {
    if (puzzleAttemptsLeft <= 0) throw new Error('unable to solve the vote puzzle');

    const userId = await ensureRegistered();
    const voteResponse = await postJson('/interact/vote', { userId, videoId, value });

    if (voteResponse.status === 401) {
        if (authRetriesLeft <= 0) throw new Error('vote submission was unauthorized');
        forget();
        return attemptVote(videoId, value, authRetriesLeft - 1, puzzleAttemptsLeft);
    }
    if (!voteResponse.ok) throw new Error('vote submission was rejected');

    const solved = await solvePuzzle(await voteResponse.json());
    if (!solved) return attemptVote(videoId, value, authRetriesLeft, puzzleAttemptsLeft - 1);

    const confirmResponse = await postJson('/interact/confirmVote', Object.assign({ userId, videoId }, solved));
    if (confirmResponse.status === 401) {
        if (authRetriesLeft <= 0) throw new Error('vote confirmation was unauthorized');
        forget();
        return attemptVote(videoId, value, authRetriesLeft - 1, puzzleAttemptsLeft);
    }
    if (!confirmResponse.ok) throw new Error('vote confirmation was rejected');

    const confirmed = await confirmResponse.json();
    if (confirmed !== true) throw new Error('vote confirmation failed');
    return true;
};

// One submission attempt, start to finish — serializing repeated calls for the same video is
// dislikeSync.js's job, not this function's.
const submitVote = (videoId, value) => attemptVote(videoId, value, 1, VOTE_PUZZLE_ATTEMPTS);

export { submitVote };
