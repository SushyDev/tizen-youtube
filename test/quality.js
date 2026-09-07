import { chooseQuality, shouldAsk } from '../mods/player/quality.js';

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

{
    const top = chooseQuality('highest', LADDER);
    check('highest takes the top rung', top === 'hd2160', JSON.stringify(top));

    const short = chooseQuality('highest', [rung('720p', 'hd720'), rung('480p', 'large')]);
    check('highest on a short ladder takes its top', short === 'hd720', JSON.stringify(short));
}

{
    const exact = chooseQuality('1080p', LADDER);
    check('a named rung is taken exactly', exact === 'hd1080', JSON.stringify(exact));

    const capped = chooseQuality('1080p', [rung('2160p', 'hd2160'), rung('1440p', 'hd1440')]);
    check('a cap below everything offered does not reach up',
        capped === null, JSON.stringify(capped));

    const nearest = chooseQuality('1440p', [rung('2160p', 'hd2160'), rung('1080p', 'hd1080'), rung('720p', 'hd720')]);
    check('a missing rung falls to the nearest below, not the maximum',
        nearest === 'hd1080', JSON.stringify(nearest));
}

{
    const filtered = chooseQuality('highest', [
        rung('2160p', 'hd2160', false),
        rung('1080p', 'hd1080')
    ]);
    check('an unplayable rung is skipped even at the top',
        filtered === 'hd1080', JSON.stringify(filtered));

    const allBad = chooseQuality('highest', [rung('2160p', 'hd2160', false)]);
    check('a ladder of unplayable rungs answers nothing', allBad === null, JSON.stringify(allBad));
}

{
    check('an empty ladder answers nothing', chooseQuality('highest', []) === null, 'expected null');
    check('a missing ladder answers nothing', chooseQuality('highest', null) === null, 'expected null');
    check('a missing ladder answers nothing for a named rung',
        chooseQuality('1080p', undefined) === null, 'expected null');
}

{
    const odd = chooseQuality('highest', [rung('auto', 'auto'), rung('1080p', 'hd1080')]);
    check('a label with no number does not outrank a real rung',
        odd === 'hd1080', JSON.stringify(odd));
}

{
    const early = chooseQuality('highest', [rung('720p', 'hd720')]);
    const later = chooseQuality('highest', [rung('1080p', 'hd1080'), rung('720p', 'hd720')]);
    const latest = chooseQuality('highest', LADDER);
    check('a longer ladder answers higher than a shorter one',
        early === 'hd720' && later === 'hd1080' && latest === 'hd2160',
        `${early} ${later} ${latest}`);
}

{
    const LIMITS = { maxAttempts: 3, retryDelay: 5000 };
    const at = (over) => Object.assign(
        { current: 'hd1080', wanted: 'hd2160', again: false, attempts: 0, askedAt: 0 }, over || {}
    );

    check('already on the wanted rung asks nothing',
        shouldAsk(at({ current: 'hd2160' }), 10000, LIMITS) === false, 'expected false');

    check('a rung we are not on is asked for',
        shouldAsk(at(), 10000, LIMITS) === true, 'expected true');

    check('nothing to want asks nothing',
        shouldAsk(at({ wanted: null }), 10000, LIMITS) === false, 'expected false');

    check('the same rung is not asked for twice in a row too quickly',
        shouldAsk(at({ again: true, attempts: 1, askedAt: 9000 }), 10000, LIMITS) === false,
        'expected false');

    check('the same rung is asked again once the delay has passed',
        shouldAsk(at({ again: true, attempts: 1, askedAt: 1000 }), 10000, LIMITS) === true,
        'expected true');

    check('a rung the player will not take is given up on',
        shouldAsk(at({ again: true, attempts: 3, askedAt: 1000 }), 10000, LIMITS) === false,
        'expected false');

    check('a different rung is asked for even after giving up on the last',
        shouldAsk(at({ wanted: 'hd1440', attempts: 3, askedAt: 1000 }), 10000, LIMITS) === true,
        'expected true');
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
