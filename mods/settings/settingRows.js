import { configRead } from '../../framework/index.js';
import { chosenLabel, chosenSummary } from './settingsModel.js';
import { optionsCommand, storeCommand } from './settingsOptions.js';
import { category, runs } from './settingsResponse.js';
import { say } from '../i18n/index.js';

const picture = (url) => ({ thumbnails: [{ url }] });

// Prefixed because the id is what the DOM claim matches on, and YouTube's own rows use ids of
// the same shape.
const idFor = (item) => `TUBE_${item.key || item.id}`;

const switchRow = (item) => ({
    settingBooleanRenderer: {
        title: runs(say(item.title)),
        summary: runs(say(item.summary)),
        enabled: configRead(item.key) === item.on,
        enableServiceEndpoint: storeCommand(item.key, item.on),
        disableServiceEndpoint: storeCommand(item.key, !item.on),
        tubeNote: item.note,
        trackingParams: 'null',
        itemId: idFor(item),
        thumbnail: picture(item.image)
    }
});

// A getter rather than a value: the row object outlives the choice, so the label is read at draw time.
const openerRow = (item, path, label) => {
    const row = {
        title: runs(say(item.title)),
        summary: runs(say(item.summary)),
        serviceEndpoint: optionsCommand(path),
        tubeNote: item.note,
        trackingParams: 'null',
        itemId: idFor(item),
        thumbnail: picture(item.image),
        get actionLabel() { return runs(label()); }
    };

    return { settingActionRenderer: row };
};

const rowFor = (item, path) =>
    item.kind === 'switch' ? switchRow(item)
        : item.kind === 'choice'
            ? openerRow(item, path, () => `${say(item.prefix)}: ${chosenLabel(item)}`)
            : openerRow(item, path, () => chosenSummary(item));

// The path is how the option panel finds this item again: which group, then which item within it.
const categoryFor = (group, groupIndex) => category(
    group.id,
    say(group.title),
    group.items.map((item, index) => rowFor(item, [groupIndex, index]))
);

export { categoryFor };
