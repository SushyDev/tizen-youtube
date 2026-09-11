// SponsorBlock: the repeat guard, the hash parse, and the overlay's geometry.

import assert from 'assert';

global.window = { localStorage: { 'tube.settings': '{}' }, addEventListener: () => undefined };
global.window.JSON = JSON;

const { repeatGuard, WINDOW } = await import('../mods/sponsorblock/repeatGuard.js');

const asked = { url: null };
const answer = { body: [] };

global.fetch = (url) => {
    asked.url = url;
    return Promise.resolve({ json: () => Promise.resolve(answer.body) });
};

const { segmentsFor } = await import('../mods/sponsorblock/segmentApi.js');
const { videoIdIn } = await import('../mods/sponsorblock/sponsorblock.js');

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

check('the first landing in a segment is never a repeat', () => {
    const guard = repeatGuard();
    assert.deepStrictEqual(guard.judge('uuid-1', 1000), { repeated: false, announce: false, count: 1 });
});

check('landing in it again inside the window is a repeat, said once', () => {
    const guard = repeatGuard();
    guard.judge('uuid-1', 1000);
    assert.deepStrictEqual(guard.judge('uuid-1', 1500), { repeated: true, announce: true, count: 2 });
});

check('and every landing after that is silent', () => {
    const guard = repeatGuard();
    guard.judge('uuid-1', 1000);
    guard.judge('uuid-1', 1200);
    assert.deepStrictEqual(guard.judge('uuid-1', 1400), { repeated: true, announce: false, count: 3 });
});

check('a return long after the first is an ordinary skip, not a fight', () => {
    const guard = repeatGuard();
    guard.judge('uuid-1', 1000);
    assert.strictEqual(guard.judge('uuid-1', 1000 + WINDOW).repeated, false);
});

check('segments are judged apart from one another', () => {
    const guard = repeatGuard();
    guard.judge('uuid-1', 1000);
    guard.judge('uuid-1', 1100);
    assert.strictEqual(guard.judge('uuid-2', 1200).repeated, false);
});

check('a cleared guard has forgotten everything', () => {
    const guard = repeatGuard();
    guard.judge('uuid-1', 1000);
    guard.clear();
    assert.strictEqual(guard.judge('uuid-1', 1100).repeated, false);
});

const hashes = [
    { hash: '#/watch?v=dQw4w9WgXcQ', expect: 'dQw4w9WgXcQ' },
    { hash: '#/watch?v=dQw4w9WgXcQ&list=WL&index=2', expect: 'dQw4w9WgXcQ' },
    { hash: '#/?c=FElibrary', expect: null },
    { hash: '#/zylon-surface?c=FEsubscriptions', expect: null },
    { hash: '#/', expect: null }
];

hashes.forEach((one) => {
    check(`${one.hash} is ${one.expect === null ? 'not a video' : one.expect}`, () => {
        assert.strictEqual(videoIdIn(one.hash), one.expect);
    });
});

const { gradientOver, stretches } = await import('../mods/sponsorblock/segmentGradient.js');
const { chapterIn, spansFor } = await import('../mods/sponsorblock/drawnBar.js');
const { commaParts, transitionOf, slideOf, translateOf, shiftOf } = await import('../mods/sponsorblock/transitions.js');
const { carry, structureOf } = await import('../mods/sponsorblock/mirror.js');
const gradientFor = (segments, duration) => gradientOver(stretches(segments, duration), { from: 0, to: duration });

const seg = (category, from, to) => ({ category, segment: [from, to], UUID: `${category}-${from}` });

check('a segment becomes a hard-edged band at its own position', () => {
    const gradient = gradientFor([seg('sponsor', 25, 50)], 100);
    assert.ok(gradient.indexOf('transparent 25%') !== -1, gradient);
    assert.ok(gradient.indexOf('transparent 50%') !== -1, gradient);
    assert.ok(/rgba\(0, 212, 0, 0?\.7\) 25%/.test(gradient), gradient);
    assert.ok(/rgba\(0, 212, 0, 0?\.7\) 50%/.test(gradient), gradient);
});

check('colours carry alpha', () => {
    const gradient = gradientFor([seg('sponsor', 0, 10)], 100);
    assert.strictEqual(gradient.indexOf('#00d400'), -1, 'an opaque hex would cover the bar');
    assert.ok(gradient.indexOf('rgba(') !== -1);
});

check('the whole timeline is one linear-gradient', () => {
    const gradient = gradientFor([seg('sponsor', 0, 10), seg('outro', 80, 95)], 100);
    assert.ok(gradient.indexOf('linear-gradient(to right,') === 0, gradient);
    assert.strictEqual(gradient.split('linear-gradient(').length - 1, 1, gradient);
});

check('a highlight is a thin mark rather than a stretch', () => {
    const gradient = gradientFor([seg('poi_highlight', 50, 90)], 100);
    assert.ok(gradient.indexOf('50.4%') !== -1, `expected a narrow band, got: ${gradient}`);
    assert.strictEqual(gradient.indexOf('90%'), -1, 'a point marker was drawn as a 40% block');
});

check('segments are ordered along the bar however they arrive', () => {
    const gradient = gradientFor([seg('outro', 80, 95), seg('intro', 0, 5)], 100);
    assert.ok(gradient.indexOf('transparent 0%') < gradient.indexOf('transparent 80%'),
        'stops must run left to right or the gradient tears');
});

check('nothing to show is no gradient at all', () => {
    assert.strictEqual(gradientFor([], 100), '');
});

const spanOf = (from, to) => ({ from, to });

check('a band is a fraction of its own chapter, not of the video', () => {
    // 140s of a 110-170s chapter is halfway along that chapter, wherever it sits in the video.
    const gradient = gradientOver(stretches([seg('sponsor', 140, 170)], 681), spanOf(110, 170));

    assert.ok(gradient.indexOf('transparent 50%') !== -1, gradient);
    assert.ok(gradient.indexOf('transparent 100%') !== -1, gradient);
    assert.strictEqual(gradient.indexOf('20.5'), -1, 'placed against the video rather than the chapter');
});

check('a segment crossing a boundary is clamped to each chapter it crosses', () => {
    const crossing = stretches([seg('sponsor', 100, 120)], 681);
    const before = gradientOver(crossing, spanOf(0, 110));
    const after = gradientOver(crossing, spanOf(110, 170));

    // It runs to the end of the one and starts at the beginning of the next, so it meets itself.
    assert.ok(before.indexOf('transparent 100%') !== -1, before);
    assert.ok(after.indexOf('transparent 0%') !== -1, after);
    assert.ok(after.indexOf('16.6') !== -1, `expected 10s of a 60s chapter, got: ${after}`);
});

check('a chapter with nothing of ours in it is not drawn at all', () => {
    assert.strictEqual(gradientOver(stretches([seg('sponsor', 0, 10)], 681), spanOf(110, 170)), '');
});

check('the chapter times are taken from the element YouTube hangs them on', () => {
    const element = { __instance: { props: { chapter: { start: 110, end: 170, width: 146 } } } };
    assert.deepStrictEqual(chapterIn(element), { from: 110, to: 170 });

    assert.strictEqual(chapterIn({}), null, 'an element carrying nothing is not a chapter');
    assert.strictEqual(chapterIn({ __instance: { props: { chapter: { start: 5, end: 5 } } } }), null,
        'a chapter covering no time would divide by zero');
});

check('carried times are preferred, and the pieces own places are the fallback', () => {
    const track = { left: 0, width: 1000 };
    const carried = [
        { element: { __instance: { props: { chapter: { start: 0, end: 110 } } } }, box: { left: 0 } },
        { element: { __instance: { props: { chapter: { start: 110, end: 170 } } } }, box: { left: 273 } }
    ];

    assert.deepStrictEqual(spansFor(carried, track, 681),
        [{ from: 0, to: 110 }, { from: 110, to: 170 }]);

    // One piece missing its chapter and the whole lot is derived, so the spans stay contiguous
    // rather than being half YouTube's numbers and half ours.
    const partial = [carried[0], { element: {}, box: { left: 500 } }];
    assert.deepStrictEqual(spansFor(partial, track, 1000), [{ from: 0, to: 500 }, { from: 500, to: 1000 }]);
});

check('a video without chapters is one piece covering the whole of it', () => {
    const whole = [{ element: {}, box: { left: 96 } }];
    assert.deepStrictEqual(spansFor(whole, { left: 96, width: 1728 }, 681), [{ from: 0, to: 681 }]);
});

check('a timing function keeps its own commas', () => {
    assert.deepStrictEqual(
        commaParts('cubic-bezier(0.05,0,0.3,1), cubic-bezier(0.25,0.1,0.25,1)'),
        ['cubic-bezier(0.05,0,0.3,1)', 'cubic-bezier(0.25,0.1,0.25,1)']
    );
});

check('the longhands are put back together one property at a time', () => {
    assert.strictEqual(transitionOf({
        transitionProperty: 'transform, opacity',
        transitionDuration: '200ms, 200ms',
        transitionTimingFunction: 'cubic-bezier(0.05,0,0.3,1), cubic-bezier(0.05,0,0.3,1)',
        transitionDelay: '0s, 0s'
    }), 'transform 200ms cubic-bezier(0.05,0,0.3,1) 0s, opacity 200ms cubic-bezier(0.05,0,0.3,1) 0s');
});

check('an ancestor carries what it would ease, not what it is easing', () => {
    // ytlr-progress-bar, which is at rest whenever it is asked but fades over 500ms when told to.
    assert.strictEqual(transitionOf({
        transitionProperty: 'opacity', transitionDuration: '500ms',
        transitionTimingFunction: 'cubic-bezier(0.25,0.1,0.25,1)', transitionDelay: '0s'
    }), 'opacity 500ms cubic-bezier(0.25,0.1,0.25,1) 0s');

    // The same element while a panel is open, when YouTube cuts it rather than fading it.
    assert.strictEqual(transitionOf({
        transitionProperty: 'none', transitionDuration: '0s',
        transitionTimingFunction: 'cubic-bezier(0.25,0.1,0.25,1)', transitionDelay: '0s'
    }), 'none');

    // The renderer between them, which declares `all` and eases nothing.
    assert.strictEqual(transitionOf({
        transitionProperty: 'all', transitionDuration: '0s',
        transitionTimingFunction: 'cubic-bezier(0.25,0.1,0.25,1)', transitionDelay: '0s'
    }), 'none');

    assert.strictEqual(transitionOf({
        transitionProperty: 'color', transitionDuration: '200ms',
        transitionTimingFunction: 'linear', transitionDelay: '0s'
    }), 'none', 'a colour fade moves nothing this overlay has to keep up with');
});

check('shorter lists repeat across the properties, as CSS repeats them', () => {
    assert.strictEqual(transitionOf({
        transitionProperty: 'transform, opacity, visibility',
        transitionDuration: '200ms, 500ms',
        transitionTimingFunction: 'linear',
        transitionDelay: '0s'
    }), 'transform 200ms linear 0s, opacity 500ms linear 0s, visibility 200ms linear 0s');
});

check('only a translation is copied onto a box of ours', () => {
    assert.strictEqual(slideOf('translateY(48px)'), 'translateY(48px)');
    assert.strictEqual(slideOf('translateX(2px) translateY(-3px)'), 'translateX(2px) translateY(-3px)');
    assert.strictEqual(slideOf('none'), 'none');

    // The player squeezed beside a panel, which the bar is already hidden for.
    assert.strictEqual(slideOf('translateX(54px) translateY(219px) scaleX(0.596875) scaleY(0.5972222)'), 'none');

    // A percentage is of the element's own size, and a box of ours has none.
    assert.strictEqual(slideOf('translateX(-50%) translateY(-50%)'), 'none');
});

const layerOf = (transition, opacity) => ({
    name: 'yt-focus-container[controls]', transition, opacity, transform: 'none', visibility: 'visible'
});

const recorded = () => {
    const writes = [];
    const element = { style: { setProperty: (name, value) => writes.push(`${name}: ${value}`) } };
    return { writes, wrapper: { element, written: {} } };
};

check('a box is told how to move before it is told where to', () => {
    const { writes, wrapper } = recorded();
    const shown = carry(wrapper, layerOf('opacity 200ms linear 0s', '1'));
    writes.length = 0;

    // A panel opening: YouTube cuts the controls, so ours are cut with them.
    const hidden = carry(shown, layerOf('none', '0'));
    assert.deepStrictEqual(writes, ['transition: none', 'opacity: 0']);
    writes.length = 0;

    // And closing, where the fade comes back in the same change as the value it fades to.
    carry(hidden, layerOf('opacity 200ms linear 0s', '1'));
    assert.deepStrictEqual(writes, ['transition: opacity 200ms linear 0s', 'opacity: 1']);
});

check('nothing that has not changed is written again', () => {
    const { writes, wrapper } = recorded();
    const once = carry(wrapper, layerOf('none', '1'));
    writes.length = 0;

    carry(once, layerOf('none', '1'));
    assert.deepStrictEqual(writes, []);
});

check('the boxes are rebuilt for a different ancestor, never for a different declaration', () => {
    const controls = layerOf('opacity 200ms linear 0s', '1');

    assert.strictEqual(structureOf([controls]), structureOf([layerOf('none', '0')]));
    assert.notStrictEqual(structureOf([controls]), structureOf([controls, Object.assign({}, controls, { name: 'div' })]));
});

check('the mirrored translation is subtracted', () => {
    assert.deepStrictEqual(translateOf('translateY(48px)'), { x: 0, y: 48 });
    assert.deepStrictEqual(translateOf('translateY(0px)'), { x: 0, y: 0 });
    assert.deepStrictEqual(translateOf('none'), { x: 0, y: 0 });
    assert.deepStrictEqual(translateOf('translate(-4px, 6px)'), { x: -4, y: 6 });
    assert.deepStrictEqual(translateOf('translateX(2px) translateY(-3px)'), { x: 2, y: -3 });

    // Anything that is not a translation costs the slide and nothing else.
    assert.deepStrictEqual(translateOf('scaleX(0.5)'), { x: 0, y: 0 });

    assert.deepStrictEqual(
        shiftOf([{ transform: 'translateY(48px)' }, { transform: 'none' }, { transform: 'translateY(2px)' }]),
        { x: 0, y: 50 }
    );
});

const suite = async () => {
    await checkAsync('the video id is never sent, only four characters of its hash', async () => {
        answer.body = [];
        await segmentsFor('dQw4w9WgXcQ');

        assert.strictEqual(asked.url.indexOf('dQw4w9WgXcQ'), -1,
            `the id itself went to the server: ${asked.url}`);

        const hash = asked.url.split('/skipSegments/')[1].split('?')[0];
        assert.strictEqual(hash.length, 4, `expected a four-character prefix, got ${hash}`);
    });

    await checkAsync('the answer covers every id sharing that prefix, and ours is picked out', async () => {
        answer.body = [
            { videoID: 'someoneElse', segments: [{ category: 'sponsor', segment: [0, 5] }] },
            { videoID: 'dQw4w9WgXcQ', segments: [{ category: 'intro', segment: [5, 9] }] }
        ];

        const segments = await segmentsFor('dQw4w9WgXcQ');
        assert.deepStrictEqual(segments, [{ category: 'intro', segment: [5, 9] }]);
    });

    await checkAsync('a prefix that answers nothing about our video is no segments', async () => {
        answer.body = [{ videoID: 'someoneElse', segments: [{ category: 'sponsor', segment: [0, 5] }] }];
        assert.deepStrictEqual(await segmentsFor('dQw4w9WgXcQ'), []);
    });

    await checkAsync('every category is asked for, including the one that is never skipped', async () => {
        answer.body = [];
        await segmentsFor('dQw4w9WgXcQ');

        const categories = JSON.parse(decodeURIComponent(asked.url.split('categories=')[1]));
        assert.ok(categories.indexOf('poi_highlight') !== -1,
            'poi_highlight is what the "Skip to highlight" button is drawn from');
        assert.ok(categories.indexOf('sponsor') !== -1);
    });

    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
};

await suite();
