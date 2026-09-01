// What the derived frame counts actually detect, since they are the only ones reported
// on a set whose renderer counts nothing.
import { account, TOLERANCE } from '../features/playbackStats.js';

const results = [];
function check(name, ok, detail) {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
}

const at = (wall, media, over) => Object.assign(
    { wall, media, rate: 1, paused: false, seeking: false, readyState: 4 }, over || {}
);

// A second of wall time that advanced the video by a second cost nobody anything.
{
    const step = account(at(0, 10), at(1000, 11));
    check('smooth playback loses nothing', step.lost === 0, JSON.stringify(step));
    check('smooth playback counts a second played',
        Math.abs(step.played - 1) < 1e-9, JSON.stringify(step));
}

// Half a second of media for a second of wall is half a second the viewer lost.
{
    const step = account(at(0, 10), at(1000, 10.5));
    check('a hitch is charged as lost time',
        Math.abs(step.lost - 0.5) < 1e-9, JSON.stringify(step));
    check('a hitch still counts what did play',
        Math.abs(step.played - 0.5) < 1e-9, JSON.stringify(step));
}

// Starved of data and not advancing at all: the case the first draft of this silently
// ignored, by skipping every sample whose readyState had fallen.
{
    const step = account(at(0, 10, { readyState: 4 }), at(1000, 10, { readyState: 1 }));
    check('a rebuffer is charged as lost time',
        Math.abs(step.lost - 1) < 1e-9, JSON.stringify(step));
}

// Sampling jitter is not a hitch.
{
    const step = account(at(0, 10), at(1000, 1 + 10 - TOLERANCE / 2));
    check('jitter under the tolerance is forgiven', step.lost === 0, JSON.stringify(step));
}

// A pause is not lost time, and the gap across it must not be either.
{
    const paused = account(at(0, 10), at(1000, 10, { paused: true }));
    check('a pause costs nothing', paused.lost === 0 && paused.played === 0, JSON.stringify(paused));
    check('a pause drops the baseline', paused.reseed === true, JSON.stringify(paused));
}

// Seeking, and the jump a seek produces once it completes.
{
    const seeking = account(at(0, 10), at(1000, 90, { seeking: true }));
    check('a seek costs nothing', seeking.lost === 0, JSON.stringify(seeking));

    const jump = account(at(0, 10), at(1000, 90));
    check('a forward jump is not counted as playback',
        jump.played === 0 && jump.lost === 0, JSON.stringify(jump));
    check('a forward jump drops the baseline', jump.reseed === true, JSON.stringify(jump));
}

// A loop puts media time backwards; it is not a hundred seconds of lost video.
{
    const step = account(at(0, 313), at(1000, 0.5));
    check('a loop is not charged as lost time', step.lost === 0, JSON.stringify(step));
    check('a loop drops the baseline', step.reseed === true, JSON.stringify(step));
}

// At double speed, two seconds of media in one second of wall is correct, not a windfall.
{
    const step = account(at(0, 10, { rate: 2 }), at(1000, 12, { rate: 2 }));
    check('double speed keeping up loses nothing', step.lost === 0, JSON.stringify(step));

    const behind = account(at(0, 10, { rate: 2 }), at(1000, 11, { rate: 2 }));
    check('double speed falling behind is charged',
        Math.abs(behind.lost - 1) < 1e-9, JSON.stringify(behind));
}

// A suspended app or a throttled timer: what happened in the gap is unknowable.
{
    const step = account(at(0, 10), at(30000, 11));
    check('a long gap is not charged to anyone', step.lost === 0, JSON.stringify(step));
    check('a long gap drops the baseline', step.reseed === true, JSON.stringify(step));
}

// The first sample has nothing to compare against.
{
    const step = account(null, at(0, 10));
    check('the first sample counts nothing', step.played === 0 && step.lost === 0, JSON.stringify(step));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
