import { configRead } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer } from './ytUI.js';
import { at, isChosen } from './settingsModel.js';

// The list a settings row opens when its answer is one of several, or several at once.
// It is YouTube's own overlay panel — the same component "Choose your location" is built
// from — so a row of this app's opens the sheet YouTube's own rows open.
//
// Addressed by a path, [group, item], which is what the row's command carries.

const OPTIONS_ACTION = 'TUBE_OPTIONS';

/** A command that draws the list for a setting, replacing the one on screen when `update`. */
const optionsCommand = (path, index, update) => ({
    customAction: {
        action: OPTIONS_ACTION,
        parameters: { path, index: index || 0, update: !!update }
    }
});

// YouTube's own settings command. `applyOurSettings` in youtube/commands.js recognises a
// key it has never heard of as one of ours.
function storeCommand(key, value) {
    const field = typeof value === 'boolean' ? 'boolValue'
        : typeof value === 'number' ? 'intValue'
            : 'stringValue';

    return {
        setClientSettingEndpoint: {
            settingDatas: [{ clientSettingEnum: { item: key }, [field]: value }]
        }
    };
}

/** Toggling one value of a set — the interpreter adds or removes it. */
function toggleInSetCommand(key, value) {
    return {
        setClientSettingEndpoint: {
            settingDatas: [{ clientSettingEnum: { item: key }, arrayValue: value }]
        }
    };
}

const checkbox = (on) => (on ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK');
const radio = (on) => (on ? 'RADIO_BUTTON_CHECKED' : 'RADIO_BUTTON_UNCHECKED');

// Every row writes the setting and draws the list again, so the mark under the cursor
// moves the instant it is pressed and the row behind is redrawn with it.
const writeThenRedraw = (setting, path, index) => [setting, optionsCommand(path, index, true)];

function rowsFor(item, path) {
    if (item.kind === 'choice') {
        const current = configRead(item.key);
        return item.options.map((option, index) => buttonItem(
            { title: option.label },
            { secondaryIcon: radio(option.value === current) },
            writeThenRedraw(storeCommand(item.key, option.value), path, index)
        ));
    }

    // Several booleans behind one row.
    if (item.kind === 'flags') {
        return item.options.map((option, index) => buttonItem(
            { title: option.label },
            { secondaryIcon: checkbox(!!configRead(option.key)) },
            writeThenRedraw(storeCommand(option.key, !configRead(option.key)), path, index)
        ));
    }

    // One array, holding whichever values are chosen.
    return item.options.map((option, index) => buttonItem(
        { title: option.label },
        { secondaryIcon: checkbox(isChosen(item, option.value)) },
        writeThenRedraw(toggleInSetCommand(item.key, option.value), path, index)
    ));
}

/**
 * Draws the list a setting's row points at. `update` replaces the sheet already on screen
 * rather than stacking a second one over it, which is what keeps Back one press however
 * many things were changed while it was open.
 */
function openOptions(parameters) {
    const options = parameters || {};
    const item = at(options.path || []);

    // A switch has no list of its own, and a path can arrive from anywhere.
    if (!item || !item.options) return;

    showModal(
        { title: item.title, subtitle: item.summary },
        overlayPanelItemListRenderer(rowsFor(item, options.path), options.index || 0),
        `tube-options-${options.path.join('-')}`,
        !!options.update
    );
}

export { openOptions, OPTIONS_ACTION, optionsCommand, storeCommand };
