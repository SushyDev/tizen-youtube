import { configRead } from '../config.js';
import { findByPrototype, sourceOf } from './internals.js';

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

export { claimBooleanRows, redrawSettingRows };
