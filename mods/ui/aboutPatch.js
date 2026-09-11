// Names the running build on Settings → About: nothing else on the set tells a page that looks
// unchanged apart from a build that never installed.

import { redrawSettingRows } from '../youtube/settingComponents.js';
import { sourceOf } from '../youtube/internals.js';
import { VERSION, COMMIT, TREE } from '../origin.js';

const PANEL = 'ytlr-setting-app-version';
const LABEL = 'Patch';
const STAMP = `${VERSION}-${COMMIT}-${TREE}`;

const RENDERS = 'this.template(';

const state = { claimed: false, panels: new WeakMap() };

const rowsKeyOf = (values) => Object.keys(values).find((key) => {
    const value = values[key];

    return Array.isArray(value)
        && value.length > 0
        && value.every((row) => row && typeof row.key === 'string' && typeof row.value === 'string');
});

// The template renders its rows from state, so the stamp is appended to that list rather than
// built as hyperscript.
const withPatch = (original) => function withTubePatch(props, values) {
    const key = values && rowsKeyOf(values);
    const rows = key && values[key];

    if (!rows || rows.some((row) => row.key === LABEL)) return original.call(this, props, values);

    const grown = Object.assign({}, values);
    grown[key] = rows.concat({ key: LABEL, value: STAMP });

    return original.call(this, props, grown);
};

// Remembered per class: this runs for every component the app builds.
const isVersionPanel = (component) => {
    if (!state.panels.has(component)) {
        state.panels.set(component, Object.getOwnPropertyNames(component)
            .some((name) => {
                try {
                    return component[name] === PANEL;
                } catch (e) {
                    return false;
                }
            }));
    }

    return state.panels.get(component);
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

const liveComponent = () => {
    const drawn = Array.from(document.querySelectorAll('*')).find((node) => node.__instance);
    return drawn && drawn.__instance;
};

// Hooks the shared base class because the panel's own class is not loaded until its row is
// focused.
function claimVersionPanel() {
    if (state.claimed) return true;

    const live = liveComponent();
    const base = live && baseComponentOf(live);
    if (!base) return false;

    Object.defineProperty(base, 'template', {
        configurable: true,
        set: function (original) {
            Object.defineProperty(this, 'template', {
                configurable: true,
                enumerable: true,
                writable: true,
                value: isVersionPanel(this.constructor) ? withPatch(original) : original
            });
        }
    });

    state.claimed = true;

    // A panel built before the accessor holds its template where the accessor cannot see it.
    const restamp = (instance) => {
        const original = instance.template;
        delete instance.template;
        instance.template = original;
    };

    const stale = Array.from(document.querySelectorAll(PANEL))
        .map((panel) => panel.__instance)
        .filter((instance) => instance && Object.prototype.hasOwnProperty.call(instance, 'template'));

    stale.forEach(restamp);
    if (stale.length) redrawSettingRows();

    return true;
}

export { claimVersionPanel };
