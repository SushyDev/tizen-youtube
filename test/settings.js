import assert from 'assert';

global.window = { localStorage: { 'tube.settings': '{}' } };
global.document = { querySelectorAll: () => [] };

const { PatchSettings } = await import('../mods/settings/nativeSettings.js');
const { GROUPS } = await import('../mods/settings/settingsModel.js');

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

const titleOf = (row) => {
    const title = row[Object.keys(row)[0]].title;
    return (title && (title.simpleText || (title.runs && title.runs[0].text))) || '?';
};

const rowsIn = (items, categoryId) => {
    const found = items
        .map((item) => item.settingCategoryCollectionRenderer)
        .filter(Boolean)
        .find((c) => c.categoryId === categoryId);

    if (!found) return null;

    return found.items.map(titleOf);
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

check('the Previews row leaves General rather than being copied', () => {
    const r = response();
    PatchSettings(r);

    const general = rowsIn(r.items, 'SETTING_CAT_TVHTML5_GENERAL') || [];
    assert.strictEqual(general.indexOf('Previews'), -1,
        'Previews is still in YouTube’s own category as well as ours');

    const everywhere = r.items
        .map((item) => item.settingCategoryCollectionRenderer)
        .filter(Boolean)
        .reduce((count, c) => count + c.items.filter((row) => titleOf(row) === 'Previews').length, 0);

    assert.strictEqual(everywhere, 1, `Previews appears ${everywhere} times; there must be exactly one`);
});

const oursKeyed = (key) => GROUPS.some((group) => group.items.some((item) => item.key === key));

check('we ship no second previews switch of our own', () => {
    assert.ok(!oursKeyed('enablePreviews'), 'our duplicate previews switch is back');
});

check('we ship no long press toggle of our own', () => {
    assert.ok(!oursKeyed('enableLongPress'), 'the long press toggle is back');
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
