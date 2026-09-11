import { account, lostBy, WINDOW } from '../features/playbackStats.js';

const SLIGHT_LAG = 0.01;

const shortfall = (step) => lostBy({ recent: [step] });

const results = [];
function check(name, ok, detail) {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
}

const at = (wall, media, over) => Object.assign(
    { wall, media, speed: 1, paused: false, seeking: false }, over || {}
);

{
    const step = account(at(0, 10), at(1000, 11));
    check('smooth playback loses nothing', shortfall(step) === 0, JSON.stringify(step));
    check('smooth playback counts a second played',
        Math.abs(step.advanced - 1) < 1e-9, JSON.stringify(step));
}

{
    const step = account(at(0, 10), at(1000, 10.5));
    check('a hitch is charged as lost time',
        Math.abs(shortfall(step) - 0.5) < 1e-9, JSON.stringify(step));
    check('a hitch still counts what did play',
        Math.abs(step.advanced - 0.5) < 1e-9, JSON.stringify(step));
}

{
    const step = account(at(0, 10), at(1000, 10));
    check('a clock that stands still is charged as lost time',
        Math.abs(shortfall(step) - 1) < 1e-9, JSON.stringify(step));
}

{
    const step = account(at(0, 10), at(1000, 1 + 10 - SLIGHT_LAG));
    check('a sample that lags slightly records it', shortfall(step) > 0, JSON.stringify(step));
}

{
    const paused = account(at(0, 10), at(1000, 10, { paused: true }));
    check('a pause costs nothing', shortfall(paused) === 0 && paused.advanced === 0, JSON.stringify(paused));
    check('a pause drops the baseline', paused.reseed === true, JSON.stringify(paused));
}

{
    const seeking = account(at(0, 10), at(1000, 90, { seeking: true }));
    check('a seek costs nothing', shortfall(seeking) === 0, JSON.stringify(seeking));

    const jump = account(at(0, 10), at(1000, 90));
    check('a forward jump is not counted as playback',
        jump.advanced === 0 && shortfall(jump) === 0, JSON.stringify(jump));
    check('a forward jump drops the baseline', jump.reseed === true, JSON.stringify(jump));
}

{
    const step = account(at(0, 313), at(1000, 0.5));
    check('a loop is not charged as lost time', shortfall(step) === 0, JSON.stringify(step));
    check('a loop drops the baseline', step.reseed === true, JSON.stringify(step));
}

{
    const step = account(at(0, 10, { speed: 2 }), at(1000, 12, { speed: 2 }));
    check('double speed keeping up loses nothing', shortfall(step) === 0, JSON.stringify(step));

    const behind = account(at(0, 10, { speed: 2 }), at(1000, 11, { speed: 2 }));
    check('double speed falling behind is charged',
        Math.abs(shortfall(behind) - 1) < 1e-9, JSON.stringify(behind));
}

{
    const step = account(at(0, 10), at(30000, 11));
    check('a long gap is not charged to anyone', shortfall(step) === 0, JSON.stringify(step));
    check('a long gap drops the baseline', step.reseed === true, JSON.stringify(step));
}

{
    const step = account(null, at(0, 10));
    check('the first sample counts nothing', step.advanced === 0 && shortfall(step) === 0, JSON.stringify(step));
}

const runFor = (fps, wobbleMs, ticks) => {
    const frame = 1 / fps;
    let wall = 0;
    let previous = null;
    const recent = [];

    for (let tick = 0; tick < ticks; tick++) {
        wall += 0.25 + (((tick % 2) ? wobbleMs : -wobbleMs) / 1000);

        // The media clock reports whole frames.
        const media = Math.floor((wall / frame) + 1e-9) * frame;
        const current = { wall: wall * 1000, media, speed: 1, paused: false, seeking: false };
        const step = account(previous, current);

        recent.push(step);
        previous = step.reseed ? null : current;
    }

    return lostBy({ recent }) * fps;
};

check('jitter at twenty-four frames a second is not charged as loss',
    runFor(24, 25, 240) < 1, `${runFor(24, 25, 240).toFixed(1)} frames`);
check('nor at thirty', runFor(30, 20, 240) < 1, `${runFor(30, 20, 240).toFixed(1)} frames`);
check('nor at sixty', runFor(60, 10, 240) < 1, `${runFor(60, 10, 240).toFixed(1)} frames`);

const stall = (() => {
    const recent = [];
    let previous = { wall: 0, media: 10, speed: 1, paused: false, seeking: false };

    for (let at = 1; at <= 8; at++) {
        const stopped = at <= 4;
        const current = { wall: at * 250, media: stopped ? 10 : 10 + ((at - 4) * 0.25),
            speed: 1, paused: false, seeking: false };
        const step = account(previous, current);
        recent.push(step);
        previous = step.reseed ? null : current;
    }

    return lostBy({ recent });
})();

check('a stall is still counted in full', Math.abs(stall - 1) < 0.01, `${stall.toFixed(3)}s`);

const overTime = (stallSeconds, thenSmoothSeconds) => {
    const tally = { recent: [] };
    let wall = 0;
    let media = 0;
    let previous = null;

    const tick = (advancing) => {
        wall += 0.25;
        if (advancing) media += 0.25;

        const current = { wall: wall * 1000, media, speed: 1, paused: false, seeking: false };
        const step = account(previous, current);

        tally.recent.push({ expected: step.expected, advanced: step.advanced });
        while (tally.recent.length > (WINDOW * 1000) / 250) tally.recent.shift();

        previous = step.reseed ? null : current;
    };

    for (let at = 0; at < stallSeconds * 4; at++) tick(false);
    for (let at = 0; at < thenSmoothSeconds * 4; at++) tick(true);

    return lostBy(tally);
};

check('a stall is reported while it is recent',
    Math.abs(overTime(5, 2) - 5) < 0.3, `${overTime(5, 2).toFixed(2)}s`);
check('and ages out once playback has been fine for the window',
    overTime(5, WINDOW + 5) < 0.3, `${overTime(5, WINDOW + 5).toFixed(2)}s`);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
