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

// Several settings live in Maps parked in the registry, found by a key only they carry.
const findMap = (key) => {
    const match = entries().find(([, value]) => value instanceof Map && value.has(key));
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

    let runner = null;
    let owner = null;

    entries().some(([, value]) => {
        if (!value || typeof value.getInstance !== 'function') return false;

        let instance;
        try {
            instance = value.getInstance();
        } catch (e) {
            return false;
        }
        if (!instance) return false;

        const method = methodMentioning(instance, ROUTER_MARKER);
        if (!method) return false;

        runner = method;
        owner = instance;
        return true;
    });

    if (!runner) return null;

    const Action = findBySource(ACTION_MARKER);
    if (!Action) return null;

    return (actionName) => runner.call(owner, new Action(actionName));
};

const reloadGuide = () => {
    const run = findActionRunner();
    if (run) run('reloadGuideAction');
};

export { findBySource, findByPrototype, findComponent, findMap, findResolver, resolve, findActionRunner, reloadGuide, sourceOf };
