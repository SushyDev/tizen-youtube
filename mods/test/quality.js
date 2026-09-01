// Which rung the preferred-quality setting resolves to, for a given list of offers.

import { chooseQuality, shouldAsk } from '../features/quality.js';

const results = [];
function check(name, ok, detail) {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
}

const rung = (label, quality, playable) => ({
    qualityLabel: label, quality, isPlayable: playable !== false
});

const LADDER = [
    rung('2160p', 'hd2160'), rung('1440p', 'hd1440'), rung('1080p', 'hd1080'),
    rung('720p', 'hd720'), rung('480p', 'large'), rung('240p', 'small')
];

// 'highest' is an instruction: the top of whatever is on offer, whatever that is today.
{
    const top = chooseQuality('highest', LADDER);
    check('highest takes the top rung', top.quality === 'hd2160', JSON.stringify(top));
    check('highest reports the height it took', top.pixels === 2160, JSON.stringify(top));

    const short = chooseQuality('highest', [rung('720p', 'hd720'), rung('480p', 'large')]);
    check('highest on a short ladder takes its top', short.quality === 'hd720', JSON.stringify(short));
}

// A named resolution is a cap, and the reason the climbing must not overshoot it.
{
    const exact = chooseQuality('1080p', LADDER);
    check('a named rung is taken exactly', exact.quality === 'hd1080', JSON.stringify(exact));
    check('a named rung reports its height', exact.pixels === 1080, JSON.stringify(exact));

    const capped = chooseQuality('1080p', [rung('2160p', 'hd2160'), rung('1440p', 'hd1440')]);
    check('a cap below everything offered does not reach up',
        capped === null, JSON.stringify(capped));

    const nearest = chooseQuality('1440p', [rung('2160p', 'hd2160'), rung('1080p', 'hd1080'), rung('720p', 'hd720')]);
    check('a missing rung falls to the nearest below, not the maximum',
        nearest.quality === 'hd1080', JSON.stringify(nearest));
}

// A rung the player has said it cannot play is not an answer.
{
    const filtered = chooseQuality('highest', [
        rung('2160p', 'hd2160', false),
        rung('1080p', 'hd1080')
    ]);
    check('an unplayable rung is skipped even at the top',
        filtered.quality === 'hd1080', JSON.stringify(filtered));

    const allBad = chooseQuality('highest', [rung('2160p', 'hd2160', false)]);
    check('a ladder of unplayable rungs answers nothing', allBad === null, JSON.stringify(allBad));
}

// The lists that turn up before a stream has been explored.
{
    check('an empty ladder answers nothing', chooseQuality('highest', []) === null, 'expected null');
    check('a missing ladder answers nothing', chooseQuality('highest', null) === null, 'expected null');
    check('a missing ladder answers nothing for a named rung',
        chooseQuality('1080p', undefined) === null, 'expected null');
}

// Heights are what the handler compares to decide whether a new list beats the old one,
// so a label it cannot read must not come back as a large number.
{
    const odd = chooseQuality('highest', [rung('auto', 'auto'), rung('1080p', 'hd1080')]);
    check('a label with no number does not outrank a real rung',
        odd.quality === 'hd1080', JSON.stringify(odd));
}

// The growth that the whole fix exists for: the same call, made again on a longer list,
// has to answer higher — otherwise there is nothing for the handler to climb to.
{
    const early = chooseQuality('highest', [rung('720p', 'hd720')]);
    const later = chooseQuality('highest', [rung('1080p', 'hd1080'), rung('720p', 'hd720')]);
    const latest = chooseQuality('highest', LADDER);
    check('a longer ladder answers higher than a shorter one',
        early.pixels < later.pixels && later.pixels < latest.pixels,
        `${early.pixels} ${later.pixels} ${latest.pixels}`);
}

// When to ask the player for a rung. Asking restarts the stream, so this is what keeps
// a video that loops from being left on whatever rung the loop reset it to, without
// pestering a player that will not take the answer.
{
    const LIMITS = { maxAttempts: 3, retryDelay: 5000 };
    const at = (over) => Object.assign(
        { current: 'hd1080', wanted: 'hd2160', target: null, attempts: 0, askedAt: 0 }, over || {}
    );

    check('already on the wanted rung asks nothing',
        shouldAsk(at({ current: 'hd2160' }), 10000, LIMITS) === false, 'expected false');

    check('a rung we are not on is asked for',
        shouldAsk(at(), 10000, LIMITS) === true, 'expected true');

    check('nothing to want asks nothing',
        shouldAsk(at({ wanted: null }), 10000, LIMITS) === false, 'expected false');

    // The loop case: same video, player reset itself to a lower rung, and the previous
    // target is still remembered from before the loop.
    check('a video that looped back below its rung is asked again',
        shouldAsk(at({ current: 'hd1440', target: 'hd2160', attempts: 1, askedAt: 0 }), 10000, LIMITS) === true,
        'expected true');

    check('the same rung is not asked for twice in a row too quickly',
        shouldAsk(at({ target: 'hd2160', attempts: 1, askedAt: 9000 }), 10000, LIMITS) === false,
        'expected false');

    check('the same rung is asked again once the delay has passed',
        shouldAsk(at({ target: 'hd2160', attempts: 1, askedAt: 1000 }), 10000, LIMITS) === true,
        'expected true');

    check('a rung the player will not take is given up on',
        shouldAsk(at({ target: 'hd2160', attempts: 3, askedAt: 1000 }), 10000, LIMITS) === false,
        'expected false');

    check('a different rung is asked for even after giving up on the last',
        shouldAsk(at({ wanted: 'hd1440', target: 'hd2160', attempts: 3, askedAt: 1000 }), 10000, LIMITS) === true,
        'expected true');
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
