import { configRead } from '../../framework/index.js';
import { chosenLabel, chosenSummary } from './settingsModel.js';
import { optionsCommand, storeCommand } from './settingsOptions.js';
import { category, runs } from './settingsResponse.js';

// Our own settings, drawn as YouTube's own rows.
//
// Nothing here is a custom widget: a switch of ours is the same settingBooleanRenderer the app
// already knows how to draw and focus, so it behaves like the rest of the page rather than like
// something bolted on.

const picture = (url) => ({ thumbnails: [{ url }] });

// Prefixed, because the id is what the DOM claim matches on and the page holds YouTube's own rows
// under ids of the same shape.
const idFor = (item) => `TUBE_${item.key || item.id}`;

const switchRow = (item) => ({
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
});

// A getter rather than a value: the label says what is currently chosen, and the row object
// outlives the choice. Read at draw time, it is right every time the panel reopens.
const openerRow = (item, path, label) => {
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
};

const rowFor = (item, path) =>
    item.kind === 'switch' ? switchRow(item)
        : item.kind === 'choice'
            ? openerRow(item, path, () => `${item.prefix}: ${chosenLabel(item)}`)
            : openerRow(item, path, () => chosenSummary(item));

// The path is where the option panel finds this item again when the row is opened: which group,
// then which item within it.
const categoryFor = (group, groupIndex) => category(
    group.id,
    group.title,
    group.items.map((item, index) => rowFor(item, [groupIndex, index]))
);

export { categoryFor };
