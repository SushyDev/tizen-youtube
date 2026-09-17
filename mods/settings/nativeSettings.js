import { configChangeEmitter, onResponse } from '../../framework/index.js';
import { GROUPS } from './settingsModel.js';
import { categoryFor } from './settingRows.js';
import { ADDED, putMoved, takeMoved } from './adoptedRows.js';
import { category, categoryOf, indexOfCategory } from './settingsResponse.js';
import { claimDrawnRows } from './claimDrawn.js';
import { redrawSettingRows } from './settingComponents.js';

// Our categories go in before YouTube's rows are taken out, so there is somewhere for them to land.

const BEFORE = 'SETTING_CAT_TVHTML5_LINK_PHONE';

const ABOUT = 'SETTING_CAT_TVHTML5_ABOUT';

const insertAt = (items, index, added) => items.splice.apply(items, [index, 0].concat(added));

// The settings response arrives more than once per session, and patching twice would double every row.
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
