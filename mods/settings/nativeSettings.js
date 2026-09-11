import { configChangeEmitter, onResponse } from '../../framework/index.js';
import { GROUPS } from './settingsModel.js';
import { categoryFor } from './settingRows.js';
import { ADDED, putMoved, takeMoved } from './adoptedRows.js';
import { category, categoryOf, indexOfCategory } from './settingsResponse.js';
import { claimDrawnRows } from './claimDrawn.js';
import { redrawSettingRows } from './settingComponents.js';

// Our settings, in YouTube's own settings page.
//
// Three things happen to the response, in this order, and the order is the point: our categories
// go in first so there is somewhere for YouTube's rows to land, its rows are then taken out of
// wherever it put them, and the categories that exist only to hold them are added last — only if
// anything landed.

const BEFORE = 'SETTING_CAT_TVHTML5_LINK_PHONE';

const ABOUT = 'SETTING_CAT_TVHTML5_ABOUT';

const insertAt = (items, index, added) => items.splice.apply(items, [index, 0].concat(added));

// Every settings response is patched, and the guide is fetched more than once per session. Ours
// being there already is how a second pass is recognised: patching twice would double every row.
const alreadyPatched = (items) => items.some((item) => {
    const found = categoryOf(item);
    return found && GROUPS.some((group) => group.id === found.categoryId);
});

function PatchSettings(response) {
    if (!Array.isArray(response.items)) return;

    const items = response.items;
    if (!items.some(categoryOf)) return;
    if (alreadyPatched(items)) return;

    claimDrawnRows();

    insertAt(items, indexOfCategory(items, BEFORE), GROUPS.map(categoryFor));

    const taken = takeMoved(items);

    const added = ADDED
        .filter((entry) => taken[entry.id] && taken[entry.id].length)
        .map((entry) => category(entry.id, entry.title, []));

    insertAt(items, indexOfCategory(items, ABOUT), added);

    putMoved(items, taken);
}

onResponse('settings', ['items'], PatchSettings);

const start = () => {
    configChangeEmitter.addEventListener('configChange', () => redrawSettingRows());
};

export { PatchSettings, start };
