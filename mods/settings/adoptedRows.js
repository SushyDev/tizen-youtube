import { categoryOf, findCategory, textOf } from './settingsResponse.js';

// YouTube's own rows moved into our categories, so no setting is shipped twice.

const SUBSCRIPTION = 'tube_subscription';
const PARENTAL = 'tube_parental';
const HISTORY = 'SETTING_CAT_TVHTML5_HISTORY';
const PLAYBACK = 'tube_playback';
const INTERFACE = 'tube_interface';

// Matched on whichever of the three the build actually carries: the item id, the client setting
// it writes, or the title. A row identified only by title survives a renamed id and not a
// translated page, which is why it is the last of the three rather than the only one.
const MOVES = [
    { to: SUBSCRIPTION, id: 'PREMIUM_LANDING_PAGE', title: 'Get YouTube Premium' },
    { to: SUBSCRIPTION, id: 'MANAGE_PURCHASES_AND_MEMBERSHIPS', title: 'Purchases and memberships' },
    { to: PLAYBACK, id: 'AUTONAV', title: 'Autoplay next video' },
    { to: PARENTAL, setting: 'SAFETY_MODE', title: 'Restricted mode' },
    { to: PARENTAL, id: 'PARENT_CODE', title: 'Parent code' },
    { to: HISTORY, id: 'RECOMMEND', title: 'Device recommendations', first: true },
    { to: INTERFACE, setting: 'ENABLE_PREVIEWS_WITH_SOUND', title: 'Previews' }
];

// Categories that exist only to hold what was moved, so they are added only when something
// actually landed in them.
const ADDED = [
    { id: SUBSCRIPTION, title: 'Subscription' },
    { id: PARENTAL, title: 'Parental controls' }
];

const rendererOf = (row) => {
    const key = row && Object.keys(row)[0];
    return key ? row[key] : null;
};

const clientSettingOf = (renderer) => {
    const endpoint = renderer.enableServiceEndpoint || renderer.serviceEndpoint;
    const datas = endpoint
        && endpoint.setClientSettingEndpoint
        && endpoint.setClientSettingEndpoint.settingDatas;

    const chosen = datas && datas[0] && datas[0].clientSettingEnum;
    return chosen ? chosen.item : '';
};

// Only a move with somewhere to land counts: taking a row out and then failing to find its
// destination would lose it from the page entirely.
const moveFor = (row, reachable) => {
    const renderer = rendererOf(row);
    if (!renderer) return null;

    const id = renderer.itemId || '';
    const setting = clientSettingOf(renderer);
    const title = textOf(renderer.title);

    const move = MOVES.find((rule) =>
        (rule.id && id.indexOf(rule.id) !== -1)
        || (rule.setting && rule.setting === setting)
        || rule.title === title);

    return move && reachable.has(move.to) ? move : null;
};

const reachableIn = (items) => new Set(ADDED
    .map((entry) => entry.id)
    .concat(items.map(categoryOf).filter(Boolean).map((found) => found.categoryId)));

const takeMoved = (items) => {
    const reachable = reachableIn(items);

    const categories = items
        .map((item) => ({ item, found: categoryOf(item) }))
        .filter(({ found }) => found && Array.isArray(found.items))
        .map(({ item, found }) => ({
            item, found, rows: found.items.map((row) => ({ row, move: moveFor(row, reachable) }))
        }));

    const taken = categories
        .reduce((all, { rows }) => all.concat(rows.filter((entry) => entry.move)), [])
        .reduce((grouped, entry) => Object.assign({}, grouped, {
            [entry.move.to]: (grouped[entry.move.to] || []).concat([entry])
        }), {});

    categories.forEach(({ found, rows }) => {
        found.items = rows.filter((entry) => !entry.move).map((entry) => entry.row);
    });

    // Emptied categories are removed after the walk, not during it: splicing mid-iteration skips
    // whatever followed each removal.
    categories
        .filter(({ found }) => found.items.length === 0)
        .forEach(({ item }) => items.splice(items.indexOf(item), 1));

    return taken;
};

// `first` rows go above whatever the category already holds — a device recommendation belongs at
// the top of History, not appended under it.
const putMoved = (items, taken) => {
    Object.keys(taken).forEach((categoryId) => {
        const found = findCategory(items, categoryId);
        if (!found) return;

        const rows = taken[categoryId];
        const lead = rows.filter((entry) => entry.move.first).map((entry) => entry.row);
        const rest = rows.filter((entry) => !entry.move.first).map((entry) => entry.row);

        found.items = lead.concat(found.items, rest);
    });
};

export { ADDED, takeMoved, putMoved };
