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
// SPONSORBLOCK end up looking like LINK TV & PHONE. Ours go in ahead of that one: after
// the entries YouTube leaves untitled at the top, and before the headings it does draw.
const BEFORE = 'SETTING_CAT_TVHTML5_LINK_PHONE';

const runs = (text) => ({ runs: [{ text }] });
const picture = (url) => ({ thumbnails: [{ url }] });
const idFor = (item) => `TUBE_${item.key || item.id}`;

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

const categoryFor = (group, groupIndex) => ({
    settingCategoryCollectionRenderer: {
        categoryId: group.id,
        title: runs(group.title),
        focused: false,
        trackingParams: 'null',
        items: group.items.map((item, index) => rowFor(item, [groupIndex, index]))
    }
});

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

    const categoryOf = (item) => item && item.settingCategoryCollectionRenderer;
    if (!response.items.some(categoryOf)) return;

    // Responses are cached and read more than once; a second pass must not double the
    // list.
    const already = (item) => {
        const category = categoryOf(item);
        return category && GROUPS.some((group) => group.id === category.categoryId);
    };
    if (response.items.some(already)) return;

    claimRows();

    const before = response.items.findIndex((item) => {
        const category = categoryOf(item);
        return category && category.categoryId === BEFORE;
    });

    const categories = GROUPS.map(categoryFor);
    const at = before === -1 ? response.items.length : before;

    response.items.splice.apply(response.items, [at, 0].concat(categories));
}

// A setting changed in the sheet over the page leaves the row underneath it showing the
// old answer until it is asked to draw again.
configChangeEmitter.addEventListener('configChange', () => redrawSettingRows());

export { PatchSettings };
