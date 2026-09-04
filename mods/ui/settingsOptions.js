import { configRead } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer } from './ytUI.js';
import { at, isChosen } from './settingsModel.js';

const OPTIONS_ACTION = 'TUBE_OPTIONS';

const optionsCommand = (path, index, update) => ({
    customAction: {
        action: OPTIONS_ACTION,
        parameters: { path, index: index || 0, update: !!update }
    }
});

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

function toggleInSetCommand(key, value) {
    return {
        setClientSettingEndpoint: {
            settingDatas: [{ clientSettingEnum: { item: key }, arrayValue: value }]
        }
    };
}

const checkbox = (on) => (on ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK');
const radio = (on) => (on ? 'RADIO_BUTTON_CHECKED' : 'RADIO_BUTTON_UNCHECKED');

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

    if (item.kind === 'flags') {
        return item.options.map((option, index) => buttonItem(
            { title: option.label },
            { secondaryIcon: checkbox(!!configRead(option.key)) },
            writeThenRedraw(storeCommand(option.key, !configRead(option.key)), path, index)
        ));
    }

    return item.options.map((option, index) => buttonItem(
        { title: option.label },
        { secondaryIcon: checkbox(isChosen(item, option.value)) },
        writeThenRedraw(toggleInSetCommand(item.key, option.value), path, index)
    ));
}

function openOptions(parameters) {
    const options = parameters || {};
    const item = at(options.path || []);

    if (!item || !item.options) return;

    showModal(
        { title: item.title, subtitle: item.summary },
        overlayPanelItemListRenderer(rowsFor(item, options.path), options.index || 0),
        `tube-options-${options.path.join('-')}`,
        !!options.update
    );
}

export { openOptions, OPTIONS_ACTION, optionsCommand, storeCommand };
