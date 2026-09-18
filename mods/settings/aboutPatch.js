import { redrawSettingRows } from './settingComponents.js';
import { COMMIT, TREE, VERSION, sourceOf } from '../../framework/index.js';

const PANEL = 'ytlr-setting-app-version';
const STAMP = `${VERSION}-${COMMIT}-${TREE}`;

const RENDERS = 'this.template(';

// The same facts the phone-facing /diag page shows under "This TV" — Patch stands on its own
// since it never needs a fetch, everything else arrives once /__tube/facts answers.
const extra = { rows: [{ key: 'Patch', value: STAMP }] };

fetch('/__tube/facts')
    .then((res) => res.json())
    .then((rows) => {
        extra.rows = extra.rows.concat(rows);
        redrawSettingRows();
    })
    .catch(() => undefined);

const state = { claimed: false, panels: new WeakMap() };

const rowsKeyOf = (values) => Object.keys(values).find((key) => {
    const value = values[key];

    return Array.isArray(value)
        && value.length > 0
        && value.every((row) => row && typeof row.key === 'string' && typeof row.value === 'string');
});

// The template renders its rows from state, so the extra facts are appended to that list rather
// than built as hyperscript.
const withPatch = (original) => function withTubePatch(props, values) {
    const key = values && rowsKeyOf(values);
    const rows = key && values[key];
    if (!rows) return original.call(this, props, values);

    const already = rows.map((row) => row.key);
    const missing = extra.rows.filter((row) => already.indexOf(row.key) === -1);
    if (!missing.length) return original.call(this, props, values);

    const grown = Object.assign({}, values);
    grown[key] = rows.concat(missing);

    return original.call(this, props, grown);
};

// Runs for every component the app builds, so the answer is remembered per class.
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

// Hooks the shared base class because the panel's own class is not loaded until its row is focused.
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
