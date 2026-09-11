import { chooseQuality } from '../mods/player/qualityLadder.js';
import { rungToAsk } from '../mods/player/qualityAsk.js';

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
    const ask = (over) => rungToAsk(Object.assign({ chosen: 'hd2160', preferred: 'auto', asked: null }, over || {}));

    // Half the videos opened with Next on the set sat here, left on Auto because Auto had already
    // reached the top when the ladder first appeared.
    check('a new playback is told even when the player is already on its rung',
        ask() === 'hd2160', JSON.stringify(ask()));

    check('what a new playback prefers is the player\'s default, not a choice',
        ask({ chosen: 'hd1080', preferred: 'hd1440' }) === 'hd1080', 'expected hd1080');

    check('a playback is told once',
        ask({ asked: 'hd2160', preferred: 'hd2160' }) === null, 'expected null');

    check('a ladder that grows is followed while what was said stands',
        ask({ asked: 'hd1080', preferred: 'hd1080' }) === 'hd2160', 'expected hd2160');

    check('and before the player has taken in what was said',
        ask({ asked: 'hd1080', preferred: 'auto' }) === 'hd2160', 'expected hd2160');

    check('a rung picked from the menu is left alone',
        ask({ asked: 'hd1080', preferred: 'hd720' }) === null, 'expected null');

    check('nothing to want asks nothing', ask({ chosen: null }) === null, 'expected null');
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
