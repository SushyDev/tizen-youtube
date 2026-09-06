const registry = () => window._yttv || {};

const entries = () => {
    const all = registry();
    return Object.keys(all).map((key) => [key, all[key]]);
};

const sourceOf = (value) => {
    try {
        return typeof value === 'function' ? value.toString() : '';
    } catch (e) {
        return '';
    }
};

const findBySource = (...markers) => {
    const match = entries().find(([, value]) => {
        const source = sourceOf(value);
        return source !== '' && markers.every((marker) => source.indexOf(marker) !== -1);
    });

    return match ? match[1] : null;
};

const findByPrototype = (matches) => {
    const match = entries().find(([, value]) => {
        if (typeof value !== 'function' || !value.prototype) return false;

        try {
            return !!matches(value.prototype);
        } catch (e) {
            return false;
        }
    });

    return match ? match[1] : null;
};

// `S` is the component's custom-element name; survives releases that rename the export.
const findComponent = (tag) => {
    const match = entries().find(([, value]) => typeof value === 'function' && value.S === tag);
    return match ? match[1] : null;
};

const findResolver = () => {
    const match = entries().find(([, value]) =>
        value && value.instance && typeof value.instance.resolveCommand === 'function');

    return match ? match[1].instance : null;
};

const resolve = (command, context) => {
    const resolver = findResolver();
    return resolver ? resolver.resolveCommand(command, context) : undefined;
};

const ROUTER_MARKER = 'ytlrActionRouter';
const ACTION_MARKER = 'this.actionName';

const findActionRunner = () => {
    const methodMentioning = (instance, marker) => {
        const prototype = Object.getPrototypeOf(instance);
        if (!prototype) return null;

        const name = Object.getOwnPropertyNames(prototype).find((key) => {
            try {
                return typeof instance[key] === 'function' && sourceOf(instance[key]).indexOf(marker) !== -1;
            } catch (e) {
                return false;
            }
        });

        return name ? instance[name] : null;
    };

    const routerOf = (value) => {
        if (!value || typeof value.getInstance !== 'function') return null;

        const instance = (() => {
            try { return value.getInstance(); } catch (e) { return null; }
        })();

        if (!instance) return null;

        const method = methodMentioning(instance, ROUTER_MARKER);
        return method ? { run: method, owner: instance } : null;
    };

    // reduce, not map().find(): getInstance() must not be called on every entry in the registry.
    const found = entries().reduce((got, [, value]) => got || routerOf(value), null);
    if (!found) return null;

    const Action = findBySource(ACTION_MARKER);
    if (!Action) return null;

    return (actionName) => found.run.call(found.owner, new Action(actionName));
};

const reloadGuide = () => {
    const run = findActionRunner();
    if (run) run('reloadGuideAction');
};

export { findBySource, findByPrototype, findComponent, findResolver, resolve, reloadGuide, sourceOf };
