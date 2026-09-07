// Names the running build on Settings → About: nothing else on the set tells a page that looks
// unchanged apart from a build that never installed.

import { redrawSettingRows } from '../youtube/settingComponents.js';
import { sourceOf } from '../youtube/internals.js';
import { VERSION, COMMIT, TREE } from '../origin.js';

const PANEL = 'ytlr-setting-app-version';
const LABEL = 'Patch';
const STAMP = `${VERSION}-${COMMIT}-${TREE}`;

const RENDERS = 'this.template(';

const state = { claimed: false };

// The template maps its rows out of state, so the line is grown into that list rather than built
// as hyperscript. Appending lands it after Client, where YouTube's own list ends.
const rowsKeyOf = (values) => Object.keys(values).find((key) => {
    const value = values[key];

    return Array.isArray(value)
        && value.length > 0
        && value.every((row) => row && typeof row.key === 'string' && typeof row.value === 'string');
});

const withPatch = (original) => function withTubePatch(props, values) {
    const key = values && rowsKeyOf(values);
    const rows = key && values[key];

    if (!rows || rows.some((row) => row.key === LABEL)) return original.call(this, props, values);

    const grown = Object.assign({}, values);
    grown[key] = rows.concat({ key: LABEL, value: STAMP });

    return original.call(this, props, grown);
};

// Remembered on the class: this runs for every component the app builds.
const isVersionPanel = (component) => {
    if (typeof component.tubeIsVersionPanel !== 'boolean') {
        component.tubeIsVersionPanel = Object.getOwnPropertyNames(component)
            .some((name) => {
                try {
                    return component[name] === PANEL;
                } catch (e) {
                    return false;
                }
            });
    }

    return component.tubeIsVersionPanel;
};

const rendersFrom = (prototype) => Object.getOwnPropertyNames(prototype).some((name) => {
    if (name === 'constructor') return false;

    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    const method = descriptor && descriptor.value;

    return typeof method === 'function' && sourceOf(method).indexOf(RENDERS) !== -1;
});

const baseComponentOf = (instance) => {
    const walk = (prototype) => {
        if (!prototype || prototype === Object.prototype) return null;

        return rendersFrom(prototype) ? prototype : walk(Object.getPrototypeOf(prototype));
    };

    return walk(Object.getPrototypeOf(instance));
};

const liveComponent = () => Array.from(document.querySelectorAll('*'))
    .map((node) => node.__instance)
    .find(Boolean);

// Claimed on the base class, walked up from a component already drawn, because the panel's own
// code is not fetched until its row is focused — whenever that is, its constructor lands here.
function claimVersionPanel() {
    if (state.claimed) return true;

    const live = liveComponent();
    const base = live && baseComponentOf(live);
    if (!base) return false;

    Object.defineProperty(base, 'template', {
        configurable: true,
        get: function () { return this.tubeTemplate; },
        set: function (original) {
            this.tubeTemplate = isVersionPanel(this.constructor) ? withPatch(original) : original;
        }
    });

    state.claimed = true;

    // A panel built before the accessor holds its template where the accessor cannot see it.
    const restamped = Array.from(document.querySelectorAll(PANEL)).filter((panel) => {
        const instance = panel.__instance;
        if (!instance || !Object.prototype.hasOwnProperty.call(instance, 'template')) return false;

        const original = instance.template;
        delete instance.template;
        instance.template = original;

        return true;
    });

    if (restamped.length) redrawSettingRows();

    return true;
}

export { claimVersionPanel };
