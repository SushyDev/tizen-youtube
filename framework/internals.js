import { waitFor } from './waitFor.js';

const registry = () => window._yttv || {};

// The registry only grows, so an unchanged size means the cached pairs are complete.
const held = { size: -1, pairs: [] };

const entries = () => {
    const all = registry();
    const keys = Object.keys(all);
    if (keys.length === held.size) return held.pairs;

    held.size = keys.length;
    held.pairs = keys.map((key) => [key, all[key]]);
    return held.pairs;
};

const sources = new WeakMap();

const sourceOf = (value) => {
    try {
        if (typeof value !== 'function') return '';

        const remembered = sources.get(value);
        if (remembered !== undefined) return remembered;

        const source = value.toString();
        sources.set(value, source);
        return source;
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

// Keep looking until the registry yields, then hand it over once.
//
// This is the primitive four features were missing, each of which had hand-rolled its own: one
// counted to forty, one stepped 250ms twenty times then 500ms for ever, one never gave up at all,
// and one polled every second. waitFor already knew how to stop; nothing had joined the two
// together.
const whenFound = (name, look, onFound, options) => waitFor(look, (found) => {
    try {
        return onFound(found);
    } catch (failure) {
        console.error(`[whenFound:${name}] failed:`, failure);
        return undefined;
    }
}, options);

const ROUTER_MARKER = 'ytlrActionRouter';
const ACTION_MARKER = 'this.actionName';

const findActionRunner = () => {
    const methodMentioning = (instance, marker) => {
        const prototype = Object.getPrototypeOf(instance);
        if (!prototype) return null;

        const name = Object.getOwnPropertyNames(prototype).find((key) => {
            try {
                const value = instance[key];
                return key !== 'constructor'
                    && typeof value === 'function'
                    && sourceOf(value).indexOf(marker) !== -1;
            } catch (e) {
                return false;
            }
        });

        return name ? instance[name] : null;
    };

    const routerOf = (value) => {
        if (!value || typeof value.getInstance !== 'function') return null;

        const instanceOf = (holder) => {
            try { return holder.getInstance(); } catch (e) { return null; }
        };

        const instance = instanceOf(value);

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
    try {
        const run = findActionRunner();
        if (run) run('reloadGuideAction');
    } catch (e) {
        console.warn('[tube] could not reload the guide:', e);
    }
};

export {
    findBySource, findByPrototype, findComponent, findResolver, resolve, reloadGuide,
    sourceOf, whenFound
};
