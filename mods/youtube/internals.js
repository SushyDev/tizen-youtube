// `window._yttv` holds every class and singleton YouTube's bundle defines, under names
// a minifier chose that change every release. So everything is found by what it does:
// a class whose source mentions a marker, a singleton with a method that mentions one.
// Every finder returns null rather than throwing when a release moves the ground.

const registry = () => window._yttv || {};

// Every value in the registry, as [name, value] pairs.
const entries = () => {
    const all = registry();
    return Object.keys(all).map((key) => [key, all[key]]);
};

// Minified classes and functions carry their markers in their own source, which is
// the only handle there is.
const sourceOf = (value) => {
    try {
        return typeof value === 'function' ? value.toString() : '';
    } catch (e) {
        return '';
    }
};

/** The first registry value whose source mentions every marker. */
const findBySource = (...markers) => {
    const match = entries().find(([, value]) => {
        const source = sourceOf(value);
        return source !== '' && markers.every((marker) => source.indexOf(marker) !== -1);
    });

    return match ? match[1] : null;
};

/** The first registry class whose prototype answers `matches`. */
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

/** The name a registry value is registered under, needed to replace it. */
const nameOf = (target) => {
    const match = entries().find(([, value]) => value === target);
    return match ? match[0] : null;
};

/** Replaces a registry value in place. */
const replace = (target, replacement) => {
    const name = nameOf(target);
    if (name) registry()[name] = replacement;
    return !!name;
};

// One singleton resolves every command the interface issues. Finding it is how this
// app both issues commands and intercepts them.
const findResolver = () => {
    const match = entries().find(([, value]) =>
        value && value.instance && typeof value.instance.resolveCommand === 'function');

    return match ? match[1].instance : null;
};

/** Issues a command through YouTube's own resolver. */
const resolve = (command, context) => {
    const resolver = findResolver();
    return resolver ? resolver.resolveCommand(command, context) : undefined;
};

// A second singleton runs named actions — `reloadGuideAction` and friends — found by
// the one marker its dispatch method always carries.
const ROUTER_MARKER = 'ytlrActionRouter';
const ACTION_MARKER = 'this.actionName';

const findActionRunner = () => {
    // A prototype method whose source mentions the router is the dispatcher, whichever
    // singleton happens to own it this release.
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

/** Asks YouTube to rebuild the sidebar from its current data. */
const reloadGuide = () => {
    const run = findActionRunner();
    if (run) run('reloadGuideAction');
};

export { findBySource, findByPrototype, nameOf, replace, findResolver, resolve, findActionRunner, reloadGuide, sourceOf };
