import { configRead, configChangeEmitter } from '../config.js';
import { GROUPS, chosenLabel, chosenSummary } from './settingsModel.js';
import { optionsCommand, storeCommand } from './settingsOptions.js';
import { claimBooleanRows, claimActionRows, redrawSettingRows, ROWS } from '../youtube/settingComponents.js';

const BEFORE = 'SETTING_CAT_TVHTML5_LINK_PHONE';

const ABOUT = 'SETTING_CAT_TVHTML5_ABOUT';

const runs = (text) => ({ runs: [{ text }] });
const picture = (url) => ({ thumbnails: [{ url }] });
const idFor = (item) => `TUBE_${item.key || item.id}`;

const categoryOf = (item) => item && item.settingCategoryCollectionRenderer;

function switchRow(item) {
    return {
        settingBooleanRenderer: {
            title: runs(item.title),
            summary: runs(item.summary),
            enabled: configRead(item.key) === item.on,
            enableServiceEndpoint: storeCommand(item.key, item.on),
            disableServiceEndpoint: storeCommand(item.key, !item.on),
            trackingParams: 'null',
            itemId: idFor(item),
            thumbnail: picture(item.image)
        }
    };
}

function openerRow(item, path, label) {
    const row = {
        title: runs(item.title),
        summary: runs(item.summary),
        serviceEndpoint: optionsCommand(path),
        tubeNote: item.note,
        trackingParams: 'null',
        itemId: idFor(item),
        thumbnail: picture(item.image)
    };

    Object.defineProperty(row, 'actionLabel', {
        enumerable: true,
        get: () => runs(label())
    });

    return { settingActionRenderer: row };
}

const rowFor = (item, path) =>
    item.kind === 'switch' ? switchRow(item)
        : item.kind === 'choice'
            ? openerRow(item, path, () => `${item.prefix}: ${chosenLabel(item)}`)
            : openerRow(item, path, () => chosenSummary(item));

const category = (categoryId, title, items) => ({
    settingCategoryCollectionRenderer: {
        categoryId,
        title: runs(title),
        focused: false,
        trackingParams: 'null',
        items
    }
});

const categoryFor = (group, groupIndex) => category(
    group.id,
    group.title,
    group.items.map((item, index) => rowFor(item, [groupIndex, index]))
);

function indexOfCategory(items, categoryId) {
    const index = items.findIndex((item) => {
        const found = categoryOf(item);
        return found && found.categoryId === categoryId;
    });

    return index === -1 ? items.length : index;
}

function findCategory(items, categoryId) {
    const index = indexOfCategory(items, categoryId);
    return index === items.length ? null : categoryOf(items[index]);
}

const SUBSCRIPTION = 'tube_subscription';
const PARENTAL = 'tube_parental';
const HISTORY = 'SETTING_CAT_TVHTML5_HISTORY';
const PLAYBACK = 'tube_playback';

const MOVES = [
    { to: SUBSCRIPTION, id: 'PREMIUM_LANDING_PAGE', title: 'Get YouTube Premium' },
    { to: SUBSCRIPTION, id: 'MANAGE_PURCHASES_AND_MEMBERSHIPS', title: 'Purchases and memberships' },
    { to: PLAYBACK, id: 'AUTONAV', title: 'Autoplay next video' },
    { to: PARENTAL, setting: 'SAFETY_MODE', title: 'Restricted mode' },
    { to: PARENTAL, id: 'PARENT_CODE', title: 'Parent code' },
    { to: HISTORY, id: 'RECOMMEND', title: 'Device recommendations', first: true }
];

const ADDED = [
    { id: SUBSCRIPTION, title: 'Subscription' },
    { id: PARENTAL, title: 'Parental controls' }
];

const textOf = (text) => {
    if (!text) return '';
    if (Array.isArray(text.runs)) return text.runs.map((run) => run.text).join('');
    return text.simpleText || '';
};

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

function moveFor(row, reachable) {
    const renderer = rendererOf(row);
    if (!renderer) return null;

    const id = renderer.itemId || '';
    const setting = clientSettingOf(renderer);
    const title = textOf(renderer.title);

    const move = MOVES.find((rule) =>
        (rule.id && id.indexOf(rule.id) !== -1)
        || (rule.setting && rule.setting === setting)
        || rule.title === title);

    return move && reachable[move.to] ? move : null;
}

function takeMoved(items) {
    const reachable = {};
    ADDED.forEach((entry) => { reachable[entry.id] = true; });
    items.forEach((item) => {
        const found = categoryOf(item);
        if (found) reachable[found.categoryId] = true;
    });

    const taken = {};

    for (let index = items.length - 1; index >= 0; index--) {
        const found = categoryOf(items[index]);
        if (!found || !Array.isArray(found.items)) continue;

        found.items = found.items.filter((row) => {
            const move = moveFor(row, reachable);
            if (!move) return true;

            (taken[move.to] = taken[move.to] || []).push({ row, move });
            return false;
        });

        if (found.items.length === 0) items.splice(index, 1);
    }

    return taken;
}

function putMoved(items, taken) {
    Object.keys(taken).forEach((categoryId) => {
        const found = findCategory(items, categoryId);
        if (!found) return;

        const rows = taken[categoryId];
        const lead = rows.filter((entry) => entry.move.first).map((entry) => entry.row);
        const rest = rows.filter((entry) => !entry.move.first).map((entry) => entry.row);

        found.items = lead.concat(found.items, rest);
    });
}

// The boolean row arrives with the settings page, but the action row’s code is only fetched
// when the first one is drawn — which can be long after this response was patched. So the
// search eases off rather than stopping, and gives up once the settings page is gone.
function claimRows(attempt = 0) {
    const claimed = claimBooleanRows();
    const annotated = claimActionRows();
    if (claimed && annotated) return;

    const settling = attempt < 20;
    if (!settling && !document.querySelector(ROWS)) return;

    setTimeout(() => claimRows(attempt + 1), settling ? 250 : 500);
}

function PatchSettings(response) {
    if (!Array.isArray(response.items)) return;

    const items = response.items;
    if (!items.some(categoryOf)) return;

    const already = (item) => {
        const found = categoryOf(item);
        return found && GROUPS.some((group) => group.id === found.categoryId);
    };
    if (items.some(already)) return;

    claimRows();

    const categories = GROUPS.map(categoryFor);
    items.splice.apply(items, [indexOfCategory(items, BEFORE), 0].concat(categories));

    const taken = takeMoved(items);

    const added = ADDED
        .filter((entry) => taken[entry.id] && taken[entry.id].length)
        .map((entry) => category(entry.id, entry.title, []));

    items.splice.apply(items, [indexOfCategory(items, ABOUT), 0].concat(added));

    putMoved(items, taken);
}

configChangeEmitter.addEventListener('configChange', () => redrawSettingRows());

export { PatchSettings };
