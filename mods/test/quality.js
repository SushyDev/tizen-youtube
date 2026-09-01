// Which rung the preferred-quality setting resolves to. This is the decision that used
// to be made once, from whatever list happened to exist a moment after playback started,
// and then pinned at both ends — which on a 4K stream left the video a rung or two below
// the best on a perfectly healthy buffer, with no way back up. The climbing is the
// handler's job; getting the answer right for a given list is this function's.

import { chooseQuality } from '../features/quality.js';

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

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
