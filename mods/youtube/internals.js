// Reaching into YouTube.
//
// The app exposes one thing to the page: `window._yttv`, an object holding
// every class and singleton its bundle defines, under names a minifier chose.
// There is no documentation and no stability — the names change on every
// release — so everything is found by what it *does* rather than what it is
// called: a class whose source mentions a marker string, a singleton with a
// method that mentions one.
//
// That search is the ugliest thing in this codebase, and the reason it lives
// here alone is that it used to live in three files at once, each with its own
// slightly different loop, each dereferencing what it found without checking.
// One copy, one set of names, and every finder returns null rather than
// throwing when a YouTube release moves the ground.

const registry = () => window._yttv || {};

// Every value in the registry, as [name, value] pairs. Used by the finders
// below rather than by anything outside this file.
const entries = () => {
    const all = registry();
    return Object.keys(all).map((key) => [key, all[key]]);
};

// The source text of a value, when it has one. Minified classes and functions
// carry their markers in their own source, which is the only handle there is.
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

// ── The command resolver ──────────────────────────────────────────────

// One singleton in the registry resolves every command the interface issues —
// opening a modal, navigating, changing a setting. Finding it is how this app
// both issues commands and intercepts them.
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

// ── The action router ─────────────────────────────────────────────────

// A second singleton runs named actions — `reloadGuideAction` and friends.
// It is found by the one marker its dispatch method always carries.
const ROUTER_MARKER = 'ytlrActionRouter';
const ACTION_MARKER = 'this.actionName';

const findActionRunner = () => {
    // A method on the prototype whose source mentions the router is the
    // dispatcher, whichever singleton happens to own it this release.
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

export { findBySource, nameOf, replace, findResolver, resolve, findActionRunner, reloadGuide, sourceOf };
