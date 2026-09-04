import { configRead, configChangeEmitter } from '../config.js';
import { GROUPS, chosenLabel, chosenSummary } from './settingsModel.js';
import { optionsCommand, storeCommand } from './settingsOptions.js';
import { claimBooleanRows, redrawSettingRows } from '../youtube/settingComponents.js';

// This app's settings, as rows on YouTube's own settings page rather than a panel laid
// over it. Every renderer here is one YouTube already draws — the same On/Off pair its
// autoplay setting uses, the same pill its language setting uses — so there is no CSS
// in this file and nothing to keep in step with a redesign.
//
// A category with a title draws a heading in the list, which is how AD BLOCKING and
// SPONSORBLOCK end up looking like LINK TV & PHONE. Ours go in ahead of that one; the
// untitled block YouTube opens the page with is emptied further down this file, so ours
// are what the page opens on.
const BEFORE = 'SETTING_CAT_TVHTML5_LINK_PHONE';

// About — help, the privacy policy, the version — reads as the end of the page, so the
// categories made below go in ahead of it rather than after it.
const ABOUT = 'SETTING_CAT_TVHTML5_ABOUT';

const runs = (text) => ({ runs: [{ text }] });
const picture = (url) => ({ thumbnails: [{ url }] });
const idFor = (item) => `TUBE_${item.key || item.id}`;

const categoryOf = (item) => item && item.settingCategoryCollectionRenderer;

// A boolean: illustration, title, summary, and the two buttons. `enabled` is the shape
// YouTube's own rows carry, but its component ignores the field and asks its settings
// service instead, which is what youtube/settingComponents.js answers for our keys.
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

// One of several, shown the way YouTube shows a language: a pill carrying the answer.
// The component reads `button` every time it draws, so a getter is what keeps the pill
// true after the value changes without the page being fetched again.
function choiceRow(item, path) {
    const row = {
        title: runs(item.title),
        trackingParams: 'null',
        itemId: idFor(item),
        thumbnail: picture(item.image)
    };

    Object.defineProperty(row, 'button', {
        enumerable: true,
        get: () => ({
            buttonRenderer: {
                text: { simpleText: `${item.prefix}: ${chosenLabel(item)}` },
                icon: { iconType: 'EDIT' },
                trackingParams: 'null',
                command: optionsCommand(path)
            }
        })
    });

    return { settingSingleOptionMenuRenderer: row };
}

// Several at once. The summary explains the setting and the button carries the answer,
// which is the same division YouTube uses for its own preferred languages row.
function listRow(item, path) {
    const row = {
        title: runs(item.title),
        summary: runs(item.summary),
        serviceEndpoint: optionsCommand(path),
        trackingParams: 'null',
        itemId: idFor(item),
        thumbnail: picture(item.image)
    };

    Object.defineProperty(row, 'actionLabel', {
        enumerable: true,
        get: () => runs(chosenSummary(item))
    });

    return { settingActionRenderer: row };
}

const rowFor = (item, path) =>
    item.kind === 'switch' ? switchRow(item)
        : item.kind === 'choice' ? choiceRow(item, path)
            : listRow(item, path);

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

/** Where a category sits in a response, or the end of it when there is no such category. */
function indexOfCategory(items, categoryId) {
    const index = items.findIndex((item) => {
        const found = categoryOf(item);
        return found && found.categoryId === categoryId;
    });

    return index === -1 ? items.length : index;
}

/** The category itself, or null when the response does not carry one by that name. */
function findCategory(items, categoryId) {
    const index = indexOfCategory(items, categoryId);
    return index === items.length ? null : categoryOf(items[index]);
}

// YouTube opens its settings page with six rows under no heading at all: Premium,
// purchases, autoplay, restricted mode, the parent code, and — on a set that lets an app
// put rows on its own home screen — device recommendations. They share nothing but the
// block, so each is moved to the category it belongs with, and the four with nowhere to
// go are given two categories of their own at the foot of the page.
//
// A rule names a row by whatever that row carries: part of its itemId, the client
// setting it writes, or its title. All three are needed. Restricted mode carries no
// itemId at all, and the ids that do exist are not stable across signing in — signed out
// the page carries PREMIUM_LANDING_PAGE_SIGN_IN, MANAGE_PURCHASES_AND_MEMBERSHIPS_SIGNED_OUT
// and AUTONAV_FOR_SIGN_OUT — so an id is matched as a fragment rather than whole.
//
// A row no rule recognises, and a row whose category this response has not got, are both
// left exactly where YouTube put them.
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
    // `first` puts it at the head of History & data, in with the other rows about what
    // this device does with what you watch, rather than below Reset app at the end of
    // them.
    { to: HISTORY, id: 'RECOMMEND', title: 'Device recommendations', first: true }
];

// Made only when there is something to put in them, so an account without the Premium
// row does not get an empty heading.
const ADDED = [
    { id: SUBSCRIPTION, title: 'Subscription' },
    { id: PARENTAL, title: 'Parental controls' }
];

const textOf = (text) => {
    if (!text) return '';
    if (Array.isArray(text.runs)) return text.runs.map((run) => run.text).join('');
    return text.simpleText || '';
};

// A row is a single renderer under a single key, whatever that key is called.
const rendererOf = (row) => {
    const key = row && Object.keys(row)[0];
    return key ? row[key] : null;
};

// The client setting a row writes, which is all there is to go on for Restricted mode.
const clientSettingOf = (renderer) => {
    const endpoint = renderer.enableServiceEndpoint || renderer.serviceEndpoint;
    const datas = endpoint
        && endpoint.setClientSettingEndpoint
        && endpoint.setClientSettingEndpoint.settingDatas;

    const chosen = datas && datas[0] && datas[0].clientSettingEnum;
    return chosen ? chosen.item : '';
};

/** The rule that claims a row, or null for one that stays where it is. */
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

/** Takes every row a rule claims out of the response, gathered by where it is going. */
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

        // Nothing is left in the untitled block once its rows have found homes, and a
        // category with no items in it draws as a gap in the list.
        if (found.items.length === 0) items.splice(index, 1);
    }

    return taken;
}

/** Puts the gathered rows into the categories they were assigned to. */
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

// The component that draws a boolean row only exists once YouTube has loaded the module
// the settings page is built from — which has happened by the time a settings response
// is being read, but not necessarily when this file is first evaluated.
function claimRows(attempt = 0) {
    if (claimBooleanRows() || attempt > 20) return;
    setTimeout(() => claimRows(attempt + 1), 250);
}

/** Adds this app's categories to a settings response. Called for every parsed response. */
function PatchSettings(response) {
    if (!Array.isArray(response.items)) return;

    const items = response.items;
    if (!items.some(categoryOf)) return;

    // Responses are cached and read more than once; a second pass must not double the
    // list.
    const already = (item) => {
        const found = categoryOf(item);
        return found && GROUPS.some((group) => group.id === found.categoryId);
    };
    if (items.some(already)) return;

    claimRows();

    // Ours go in first, so that a row of YouTube's moved into one of them — autoplay,
    // into Playback — has somewhere to land.
    const categories = GROUPS.map(categoryFor);
    items.splice.apply(items, [indexOfCategory(items, BEFORE), 0].concat(categories));

    const taken = takeMoved(items);

    const added = ADDED
        .filter((entry) => taken[entry.id] && taken[entry.id].length)
        .map((entry) => category(entry.id, entry.title, []));

    items.splice.apply(items, [indexOfCategory(items, ABOUT), 0].concat(added));

    putMoved(items, taken);
}

// A setting changed in the sheet over the page leaves the row underneath it showing the
// old answer until it is asked to draw again.
configChangeEmitter.addEventListener('configChange', () => redrawSettingRows());

export { PatchSettings };
