import { configRead } from '../config.js';
import { findByPrototype, findBySource, findComponent, sourceOf } from './internals.js';

const getterOf = (prototype, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    return descriptor && typeof descriptor.get === 'function' ? descriptor.get : null;
};

const findBooleanRow = () => findByPrototype((prototype) =>
    getterOf(prototype, 'enabled')
    && getterOf(prototype, 'enabledLabel')
    && getterOf(prototype, 'disabledLabel'));

const settingOf = (endpoint) => {
    const datas = endpoint
        && endpoint.setClientSettingEndpoint
        && endpoint.setClientSettingEndpoint.settingDatas;

    const data = datas && datas[0];
    if (!data || !data.clientSettingEnum || typeof data.boolValue !== 'boolean') return null;

    const key = data.clientSettingEnum.item;
    return configRead(key) === undefined ? null : { key, on: data.boolValue };
};

let claimed = false;

function claimBooleanRows() {
    if (claimed) return true;

    const component = findBooleanRow();
    if (!component) return false;

    const original = getterOf(component.prototype, 'enabled');
    if (!original) return false;

    Object.defineProperty(component.prototype, 'enabled', {
        configurable: true,
        get: function () {
            const data = this.props && this.props.data;
            const ours = data && settingOf(data.enableServiceEndpoint);

            return ours ? configRead(ours.key) === ours.on : original.call(this);
        }
    });

    claimed = true;
    return true;
}

const ACTION_ROW = 'ytlr-setting-action-renderer';

// Action rows have no footer template; wFmJpd/vAMQc are YouTube's own note classes. Nodes are
// stamped with a private symbol when built, so the footer must come from YouTube's hyperscript.
const findHyperscript = () => findBySource('.type=', '.props=', '.children=');

const noteFor = (H, note) => H(
    'div',
    { className: 'wFmJpd', idomKey: 'tube-note' },
    H('div', { className: 'vAMQc', 'aria-label': note }, note)
);

const withNote = (original, H) => function (props, state) {
    const tree = original.call(this, props, state);
    const note = props && props.data && props.data.tubeNote;

    if (note && tree && Array.isArray(tree.children)) tree.children.push(noteFor(H, note));

    return tree;
};

let noted = false;

// `template` is assigned per instance in the constructor, so the wrap has to be an accessor.
function claimActionRows() {
    if (noted) return true;

    const component = findComponent(ACTION_ROW);
    if (!component) return false;

    const H = findHyperscript();
    if (!H) return false;

    Object.defineProperty(component.prototype, 'template', {
        configurable: true,
        get: function () { return this.tubeTemplate; },
        set: function (original) { this.tubeTemplate = withNote(original, H); }
    });

    const standing = document.querySelectorAll(ACTION_ROW);

    for (let index = 0; index < standing.length; index++) {
        const instance = standing[index].__instance;
        if (!instance || !Object.prototype.hasOwnProperty.call(instance, 'template')) continue;

        const original = instance.template;
        delete instance.template;
        instance.template = original;
    }

    noted = true;
    redrawSettingRows();
    return true;
}

const ROWS = [
    'ytlr-setting-boolean-renderer',
    'ytlr-setting-single-option-menu-renderer',
    'ytlr-setting-action-renderer'
].join(',');

let redrawName = null;

const findRedraw = (instance) => {
    let prototype = Object.getPrototypeOf(instance);

    while (prototype && prototype !== Object.prototype) {
        const name = Object.getOwnPropertyNames(prototype).find((key) => {
            const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
            const method = descriptor && descriptor.value;
            if (typeof method !== 'function' || method.length !== 0) return false;

            const source = sourceOf(method);
            return source.indexOf('this.state') !== -1 && source.indexOf('Object.assign') === -1;
        });

        if (name) return name;
        prototype = Object.getPrototypeOf(prototype);
    }

    return null;
};

function redrawSettingRows() {
    const rows = document.querySelectorAll(ROWS);

    for (let index = 0; index < rows.length; index++) {
        const instance = rows[index].__instance;
        if (!instance) continue;

        if (!redrawName) redrawName = findRedraw(instance);

        const redraw = redrawName && instance[redrawName];
        if (typeof redraw === 'function') redraw.call(instance);
    }
}

export { claimBooleanRows, claimActionRows, redrawSettingRows, ROWS };
