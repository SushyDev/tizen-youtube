import { test, expect, switchOf } from './tube.js';

const VERTICAL = 'verticalListDurationMs';
const HORIZONTAL = 'horizontalListDurationMs';

const CHOSEN = { vertical: 110, horizontal: 60 };

test('a chosen speed replaces the pacing, and Default leaves it', async ({ page, open }) => {
    await open({ scrollSpeed: '' });
    const theirs = {
        vertical: await switchOf(page, VERTICAL),
        horizontal: await switchOf(page, HORIZONTAL)
    };

    // Default may read undefined, which means kabuki uses its built-in pacing.
    expect(theirs, 'Default answered with our own numbers').not.toEqual(CHOSEN);

    await open({ scrollSpeed: '2' });
    expect(await switchOf(page, VERTICAL)).toBe(CHOSEN.vertical);
    expect(await switchOf(page, HORIZONTAL)).toBe(CHOSEN.horizontal);
});

test('smoother navigation answers three switches, and only while it is on', async ({ page, open }) => {
    const SWITCHES = {
        enableCancellableJobDeferral: true,
        enableDeferredThumbnailOnScroll: true,
        enableVirtualListItemTransition: false
    };
    const names = Object.keys(SWITCHES);

    await open({ enableSmoothNavigation: false });
    const theirs = {};
    await Promise.all(names.map(async (name) => { theirs[name] = await switchOf(page, name); }));

    await open({ enableSmoothNavigation: true });
    const ours = {};
    await Promise.all(names.map(async (name) => { ours[name] = await switchOf(page, name); }));

    expect(ours).toEqual(SWITCHES);

    // If YouTube already ships all three the way we want them, there is nothing to tell apart —
    // which is worth saying rather than passing on.
    test.skip(names.every((name) => theirs[name] === SWITCHES[name]),
        `YouTube already serves all three as we would set them: ${JSON.stringify(theirs)}`);

    expect(theirs, 'turning it off changed nothing').not.toEqual(SWITCHES);
});
