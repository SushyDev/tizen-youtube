// What the derived frame counts actually detect, since they are the only ones reported
// on a set whose renderer counts nothing.
import { account, lostBy, TOLERANCE, install, sample } from '../features/playbackStats.js';

// A step reports what was expected of it and what arrived; the loss is the difference, and
// over many steps it is the difference of the totals, so jitter cancels instead of adding up.
const shortfall = (step) => lostBy({ expected: step.expected, advanced: step.advanced });

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
    check('smooth playback loses nothing', shortfall(step) === 0, JSON.stringify(step));
    check('smooth playback counts a second played',
        Math.abs(step.played - 1) < 1e-9, JSON.stringify(step));
}

// Half a second of media for a second of wall is half a second the viewer lost.
{
    const step = account(at(0, 10), at(1000, 10.5));
    check('a hitch is charged as lost time',
        Math.abs(shortfall(step) - 0.5) < 1e-9, JSON.stringify(step));
    check('a hitch still counts what did play',
        Math.abs(step.played - 0.5) < 1e-9, JSON.stringify(step));
}

// Starved of data and not advancing at all: the case the first draft of this silently
// ignored, by skipping every sample whose readyState had fallen.
{
    const step = account(at(0, 10, { readyState: 4 }), at(1000, 10, { readyState: 1 }));
    check('a rebuffer is charged as lost time',
        Math.abs(shortfall(step) - 1) < 1e-9, JSON.stringify(step));
}

// Sampling jitter is not a hitch.
{
    const step = account(at(0, 10), at(1000, 1 + 10 - TOLERANCE / 2));
    // Not forgiven in a single step any more: a shortfall is recorded honestly and cancels
    // against the sample that catches up, which is what the run above measures.
    check('a sample that lags slightly records it', shortfall(step) > 0, JSON.stringify(step));
}

// A pause is not lost time, and the gap across it must not be either.
{
    const paused = account(at(0, 10), at(1000, 10, { paused: true }));
    check('a pause costs nothing', shortfall(paused) === 0 && paused.played === 0, JSON.stringify(paused));
    check('a pause drops the baseline', paused.reseed === true, JSON.stringify(paused));
}

// Seeking, and the jump a seek produces once it completes.
{
    const seeking = account(at(0, 10), at(1000, 90, { seeking: true }));
    check('a seek costs nothing', shortfall(seeking) === 0, JSON.stringify(seeking));

    const jump = account(at(0, 10), at(1000, 90));
    check('a forward jump is not counted as playback',
        jump.played === 0 && shortfall(jump) === 0, JSON.stringify(jump));
    check('a forward jump drops the baseline', jump.reseed === true, JSON.stringify(jump));
}

// A loop puts media time backwards; it is not a hundred seconds of lost video.
{
    const step = account(at(0, 313), at(1000, 0.5));
    check('a loop is not charged as lost time', shortfall(step) === 0, JSON.stringify(step));
    check('a loop drops the baseline', step.reseed === true, JSON.stringify(step));
}

// At double speed, two seconds of media in one second of wall is correct, not a windfall.
{
    const step = account(at(0, 10, { rate: 2 }), at(1000, 12, { rate: 2 }));
    check('double speed keeping up loses nothing', shortfall(step) === 0, JSON.stringify(step));

    const behind = account(at(0, 10, { rate: 2 }), at(1000, 11, { rate: 2 }));
    check('double speed falling behind is charged',
        Math.abs(shortfall(behind) - 1) < 1e-9, JSON.stringify(behind));
}

// A suspended app or a throttled timer: what happened in the gap is unknowable.
{
    const step = account(at(0, 10), at(30000, 11));
    check('a long gap is not charged to anyone', shortfall(step) === 0, JSON.stringify(step));
    check('a long gap drops the baseline', step.reseed === true, JSON.stringify(step));
}

// The first sample has nothing to compare against.
{
    const step = account(null, at(0, 10));
    check('the first sample counts nothing', step.played === 0 && shortfall(step) === 0, JSON.stringify(step));
}

// The counts have to reach getVideoPlaybackQuality(), because that is what the player
// reads to build the stats line. Zeroes there show as a dash, however well they are kept.
{
    const listeners = {};
    const video = {
        currentTime: 0, playbackRate: 1, paused: false, seeking: false, readyState: 4,
        videoWidth: 3840, videoHeight: 2160,
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
    };

    let native = { totalVideoFrames: 0, droppedVideoFrames: 0, creationTime: 0 };

    global.window = { HTMLVideoElement: function () {} };
    global.window.HTMLVideoElement.prototype.getVideoPlaybackQuality = function () { return native; };
    global.document = { addEventListener() {}, querySelector() { return null; } };

    install();

    const proto = global.window.HTMLVideoElement.prototype;
    check('the patch is installed on the prototype', proto.getVideoPlaybackQuality.__tube === true);

    // Two samples a second apart, the video advancing only 0.8s of it.
    const quality = () => proto.getVideoPlaybackQuality.call(video);
    const realNow = Date.now;
    let clock = 1000000;
    Date.now = () => clock;

    sample(video);
    clock += 1000;
    video.currentTime = 0.8;
    sample(video);

    Date.now = realNow;

    const derived = quality();
    check('a renderer counting nothing gets derived counts',
        derived.tubeDerived === true && derived.totalVideoFrames > 0, JSON.stringify(derived));
    check('lost time becomes dropped frames',
        derived.droppedVideoFrames > 0, JSON.stringify(derived));

    native = { totalVideoFrames: 120, droppedVideoFrames: 3, creationTime: 0 };
    const real = quality();
    check('a renderer that counts is passed through untouched',
        real.totalVideoFrames === 120 && real.droppedVideoFrames === 3 && !real.tubeDerived,
        JSON.stringify(real));
}

const failed = results.filter((r) => !r).length;

// Sampling jitter is zero-mean, and charging each sample's shortfall as it happens turns it
// into a large positive total. Measured against thirty seconds of the television's own
// playback: the media clock kept up exactly, and the old accounting still reported forty-one
// dropped frames. The deficit of the totals is what actually happened.
const runFor = (fps, wobbleMs, ticks) => {
    const frame = 1 / fps;
    let wall = 0;
    let previous = null;
    const tally = { played: 0, expected: 0, advanced: 0 };

    for (let tick = 0; tick < ticks; tick++) {
        wall += 0.25 + (((tick % 2) ? wobbleMs : -wobbleMs) / 1000);

        // The media clock reports whole frames, as it does when it carries the presented
        // frame's timestamp — which is where the per-sample lag came from.
        const media = Math.floor((wall / frame) + 1e-9) * frame;
        const current = { wall: wall * 1000, media, rate: 1, paused: false, seeking: false };
        const step = account(previous, current);

        tally.expected += step.expected;
        tally.advanced += step.advanced;
        previous = step.reseed ? null : current;
    }

    return lostBy(tally) * fps;
};

check('jitter at twenty-four frames a second is not charged as loss',
    runFor(24, 25, 240) < 1, `${runFor(24, 25, 240).toFixed(1)} frames`);
check('nor at thirty', runFor(30, 20, 240) < 1, `${runFor(30, 20, 240).toFixed(1)} frames`);
check('nor at sixty', runFor(60, 10, 240) < 1, `${runFor(60, 10, 240).toFixed(1)} frames`);

// A stall is a real deficit and must survive the cancelling.
const stall = (() => {
    const tally = { played: 0, expected: 0, advanced: 0 };
    let previous = { wall: 0, media: 10, rate: 1, paused: false, seeking: false };

    // A second of the clock not moving, then a second of ordinary playback.
    for (let at = 1; at <= 8; at++) {
        const stopped = at <= 4;
        const current = { wall: at * 250, media: stopped ? 10 : 10 + ((at - 4) * 0.25),
            rate: 1, paused: false, seeking: false };
        const step = account(previous, current);
        tally.expected += step.expected;
        tally.advanced += step.advanced;
        previous = step.reseed ? null : current;
    }

    return lostBy(tally);
})();

check('a stall is still counted in full', Math.abs(stall - 1) < 0.01, `${stall.toFixed(3)}s`);

console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
