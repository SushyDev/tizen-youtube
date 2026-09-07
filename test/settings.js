// Adopting YouTube's own settings rows into ours.
//
// The rule this pins: where YouTube already ships a switch for something, we move it into one of
// our categories rather than shipping a second one beside it. That is not a tidiness preference —
// the previews pair wrote the *same* ENABLE_PREVIEWS_WITH_SOUND flag from two places, and ours
// re-forced it on every page load, so turning YouTube's off did not stay off.

import assert from 'assert';

global.window = { localStorage: { 'tube.settings': '{}' } };
global.document = { querySelectorAll: () => [] };

const { PatchSettings } = await import('../mods/settings/nativeSettings.js');

const results = [];

const check = (name, run) => {
    try {
        run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 5).join('\n      ')}`);
    }
};

// The shapes YouTube sends, cut down to what the move actually reads.
const booleanRow = (title, settingItem) => ({
    settingBooleanRenderer: {
        title: { runs: [{ text: title }] },
        enableServiceEndpoint: {
            setClientSettingEndpoint: {
                settingDatas: [{ clientSettingEnum: { item: settingItem }, boolValue: true }]
            }
        }
    }
});

const actionRow = (title, itemId) => ({
    settingActionRenderer: { title: { runs: [{ text: title }] }, itemId }
});

const category = (categoryId, title, items) => ({
    settingCategoryCollectionRenderer: { categoryId, title: { runs: [{ text: title }] }, items }
});

const rowsIn = (items, categoryId) => {
    const found = items
        .map((item) => item.settingCategoryCollectionRenderer)
        .filter(Boolean)
        .find((c) => c.categoryId === categoryId);

    if (!found) return null;

    return found.items.map((row) => {
        const renderer = row[Object.keys(row)[0]];
        const title = renderer.title;
        return (title && (title.simpleText || (title.runs && title.runs[0].text))) || '?';
    });
};

const response = () => ({
    items: [
        category('SETTING_CAT_TVHTML5_GENERAL', 'General', [
            booleanRow('Previews', 'ENABLE_PREVIEWS_WITH_SOUND'),
            booleanRow('Restricted mode', 'SAFETY_MODE'),
            actionRow('Autoplay next video', 'AUTONAV'),
            booleanRow('Something of theirs we do not touch', 'SOME_OTHER_FLAG')
        ]),
        category('SETTING_CAT_TVHTML5_ABOUT', 'About', [])
    ]
});

check('YouTube’s Previews row is adopted into our Interface category', () => {
    const r = response();
    PatchSettings(r);

    const ours = rowsIn(r.items, 'tube_interface');
    assert.ok(ours, 'our Interface category was never injected');
    assert.ok(ours.indexOf('Previews') !== -1,
        `Previews did not land in Interface — it holds ${JSON.stringify(ours)}`);
});

check('and it is moved, not copied', () => {
    const r = response();
    PatchSettings(r);

    const general = rowsIn(r.items, 'SETTING_CAT_TVHTML5_GENERAL') || [];
    assert.strictEqual(general.indexOf('Previews'), -1,
        'Previews is still in YouTube’s own category as well as ours');

    const everywhere = r.items
        .map((item) => item.settingCategoryCollectionRenderer)
        .filter(Boolean)
        .reduce((count, c) => count + c.items.filter((row) => {
            const renderer = row[Object.keys(row)[0]];
            const title = renderer.title;
            return ((title && (title.simpleText || (title.runs && title.runs[0].text))) || '') === 'Previews';
        }).length, 0);

    assert.strictEqual(everywhere, 1, `Previews appears ${everywhere} times; there must be exactly one`);
});

check('we ship no second previews switch of our own', () => {
    const r = response();
    PatchSettings(r);

    // Ours wrote the same flag from a row titled "Video previews". Both are gone; if either comes
    // back, the flag has two owners again and the viewer's choice stops sticking.
    const titles = r.items
        .map((item) => item.settingCategoryCollectionRenderer)
        .filter(Boolean)
        .reduce((all, c) => all.concat(c.items.map((row) => {
            const renderer = row[Object.keys(row)[0]];
            const title = renderer.title;
            return (title && (title.simpleText || (title.runs && title.runs[0].text))) || '';
        })), []);

    assert.strictEqual(titles.indexOf('Video previews'), -1, 'our duplicate previews row is back');
    assert.strictEqual(titles.indexOf('Long press actions'), -1, 'the long press toggle is back');
});

check('the rows we do not claim are left where YouTube put them', () => {
    const r = response();
    PatchSettings(r);

    const general = rowsIn(r.items, 'SETTING_CAT_TVHTML5_GENERAL') || [];
    assert.ok(general.indexOf('Something of theirs we do not touch') !== -1,
        `an unclaimed row was moved — General holds ${JSON.stringify(general)}`);
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
