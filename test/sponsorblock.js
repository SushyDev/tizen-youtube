// SponsorBlock, in the two places it makes a decision.
//
// This was one 322-line file holding the API call, the overlay, the skipping and the session. The
// overlay needs a screen and the session needs a video element, but the other two do not: what to
// ask the server, and when to stop skipping something the viewer keeps seeking back into, are both
// answerable here.

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

// Read off the set: navigating to the Library left `window.sponsorblock.videoID === "?c=FElibrary"`,
// because the old parser trimmed a "?v=" prefix and handed back anything that did not start with
// one. Exercised through the same listener the page uses.
const hashes = [
    { hash: '#/watch?v=dQw4w9WgXcQ', expect: 'dQw4w9WgXcQ' },
    { hash: '#/watch?v=dQw4w9WgXcQ&list=WL&index=2', expect: 'dQw4w9WgXcQ' },
    { hash: '#/?c=FElibrary', expect: null },
    { hash: '#/zylon-surface?c=FEsubscriptions', expect: null },
    { hash: '#/', expect: null }
];

// The shipped function, not a copy of it. The first version of this test reimplemented the parse
// with `new URL(...).searchParams`, which works in node and does not exist in Cobalt — so the test
// passed while the set had no SponsorBlock at all. A test that rewrites what it is testing is
// testing itself.
hashes.forEach((one) => {
    check(`${one.hash} is ${one.expect === null ? 'not a video' : one.expect}`, () => {
        assert.strictEqual(videoIdIn(one.hash), one.expect);
    });
});

// Whether the parse reaches for something the engine lacks is not checked here. A grep over the
// source cannot tell code from the comment explaining it — this check first failed on its own
// commentary. tools/check-output.js answers it properly, on the built bundle and on the AST:
// `URLSearchParams` and `.searchParams` are both listed for the cobalt3 floor.

// The timeline tint. One element outside the player's own tree, carrying every segment as one
// gradient: appending into the track lost the node to the next incremental-DOM patch within
// seconds, and ::after — which no patch could have removed — renders as nothing at all on Cobalt.
// Both measured on the set.
const {
    gradientFor, gradientOver, stretches, chapterIn, spansFor,
    commaParts, transitionOf, animatesMotion, translateOf, shiftOf
} = await import('../mods/sponsorblock/segmentOverlay.js');

const seg = (category, from, to) => ({ category, segment: [from, to], UUID: `${category}-${from}` });

check('a segment becomes a hard-edged band at its own position', () => {
    const gradient = gradientFor([seg('sponsor', 25, 50)], 100);
    assert.ok(gradient.indexOf('transparent 25%') !== -1, gradient);
    assert.ok(gradient.indexOf('transparent 50%') !== -1, gradient);
    assert.ok(/rgba\(0, 212, 0, 0?\.7\) 25%/.test(gradient), gradient);
    assert.ok(/rgba\(0, 212, 0, 0?\.7\) 50%/.test(gradient), gradient);
});

check('the colours carry alpha, so the timeline reads through them', () => {
    const gradient = gradientFor([seg('sponsor', 0, 10)], 100);
    assert.strictEqual(gradient.indexOf('#00d400'), -1, 'an opaque hex would cover the bar');
    assert.ok(gradient.indexOf('rgba(') !== -1);
});

check('it is one gradient, which is all this engine can actually draw', () => {
    const gradient = gradientFor([seg('sponsor', 0, 10), seg('outro', 80, 95)], 100);
    assert.ok(gradient.indexOf('linear-gradient(to right,') === 0, gradient);
    assert.strictEqual(gradient.indexOf('::after'), -1,
        'Cobalt renders no pseudo-elements — a probe giving ::after a 37px box measured 0');
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

// Where the bands are placed, which is the part that was wrong on screen for real videos.
//
// YouTube's bar is one div per chapter with a 6px gap between them, and each chapter is drawn
// `width` px wide for a stretch of timeline that is `width + gap` px. So it fits the chapter's
// whole time range into the narrower box, and a position along that box is a fraction of the
// chapter's own start and end — never of the video's duration. Placing bands by the timeline
// instead put each one up to 6px right of where it belonged, drifting further with every chapter
// passed. Settled against YouTube's own played fill on the set: at 58.871s of a 0-110s chapter
// drawn 273px wide it measures 146px, and the chapter's rule gives 146.1 where the timeline's
// gives 149.4.
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

// Moving with the bar. Cobalt's getComputedStyle answers with the value a transition is heading
// for rather than the one it is showing — measured: `transitionend` at 399ms of a 400ms fade while
// forty-three frames of sampling all read the final value — so the bands cannot follow by watching.
// They are handed the same declarations instead, and the engine runs both.
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

check('an ancestor is mirrored for what it would move, not what it is moving', () => {
    // ytlr-progress-bar, which is at rest whenever it is asked but fades over 500ms when told to.
    assert.ok(animatesMotion({
        transitionProperty: 'opacity', transitionDuration: '500ms',
        transitionTimingFunction: 'cubic-bezier(0.25,0.1,0.25,1)', transitionDelay: '0s'
    }));

    // The renderer between them, which declares `all` and eases nothing.
    assert.strictEqual(animatesMotion({
        transitionProperty: 'all', transitionDuration: '0s',
        transitionTimingFunction: 'cubic-bezier(0.25,0.1,0.25,1)', transitionDelay: '0s'
    }), false);

    assert.strictEqual(animatesMotion({
        transitionProperty: 'color', transitionDuration: '200ms',
        transitionTimingFunction: 'linear', transitionDelay: '0s'
    }), false, 'a colour fade moves nothing this overlay has to keep up with');
});

check('the slide is taken off a measured position, because the mirror puts it back', () => {
    assert.deepStrictEqual(translateOf('translateY(48px)'), { x: 0, y: 48 });
    assert.deepStrictEqual(translateOf('translateY(0px)'), { x: 0, y: 0 });
    assert.deepStrictEqual(translateOf('none'), { x: 0, y: 0 });
    assert.deepStrictEqual(translateOf('translate(-4px, 6px)'), { x: -4, y: 6 });

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
