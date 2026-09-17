import { categoryOf, findCategory, textOf } from './settingsResponse.js';

const SUBSCRIPTION = 'tube_subscription';
const PARENTAL = 'tube_parental';
const HISTORY = 'SETTING_CAT_TVHTML5_HISTORY';
const PLAYBACK = 'tube_playback';
const FEED = 'tube_feed';

// Matched on the item id, the client setting it writes, or the title, title last because it
// survives a renamed id but not a translated page.
const MOVES = [
    { to: SUBSCRIPTION, id: 'PREMIUM_LANDING_PAGE', title: 'Get YouTube Premium' },
    { to: SUBSCRIPTION, id: 'MANAGE_PURCHASES_AND_MEMBERSHIPS', title: 'Purchases and memberships' },
    { to: PLAYBACK, id: 'AUTONAV', title: 'Autoplay next video' },
    { to: PARENTAL, setting: 'SAFETY_MODE', title: 'Restricted mode' },
    { to: PARENTAL, id: 'PARENT_CODE', title: 'Parent code' },
    { to: HISTORY, id: 'RECOMMEND', title: 'Device recommendations', first: true },
    { to: FEED, setting: 'ENABLE_PREVIEWS_WITH_SOUND', title: 'Previews' }
];

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

// A row taken out without a reachable destination would be lost from the page entirely.
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

    // Emptied categories are removed after the walk: splicing mid-iteration skips whatever
    // followed each removal.
    categories
        .filter(({ found }) => found.items.length === 0)
        .forEach(({ item }) => items.splice(items.indexOf(item), 1));

    return taken;
};

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
