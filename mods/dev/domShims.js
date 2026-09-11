// DOM behaviour a debugger needs that this engine lacks.

const holder = { element: null };

// kabuki's Text.prototype.data setter dereferences parentNode, which is null on detached nodes.
const shimParentNode = () => {
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'parentNode');
    if (!descriptor || !descriptor.get || !descriptor.configurable) return false;

    holder.element = document.createElement('div');

    Object.defineProperty(Node.prototype, 'parentNode', {
        configurable: true,
        enumerable: !!descriptor.enumerable,
        get: function parentNode() {
            const real = descriptor.get.call(this);
            if (real) return real;

            return (window.__tubeInspecting && this.nodeType === 3) ? holder.element : real;
        }
    });

    return true;
};

const rangeFor = () => {
    const held = { start: null, end: null, collapsed: true };

    const boxOf = () => {
        const node = held.start;
        const element = node && (node.nodeType === 1 ? node : node.parentElement);

        return element && element.getBoundingClientRect
            ? element.getBoundingClientRect()
            : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    };

    return {
        get startContainer() { return held.start; },
        get endContainer() { return held.end; },
        get collapsed() { return held.collapsed; },
        selectNode: (node) => { held.start = node; held.end = node; held.collapsed = false; },
        selectNodeContents: (node) => { held.start = node; held.end = node; held.collapsed = false; },
        setStart: (node) => { held.start = node; },
        setEnd: (node) => { held.end = node; },
        collapse: () => { held.collapsed = true; },
        cloneContents: () => document.createDocumentFragment(),
        getBoundingClientRect: boxOf,
        getClientRects: () => [boxOf()],
        detach: () => undefined,
        toString: () => ''
    };
};

const shimRange = () => {
    if (typeof document.createRange !== 'undefined') return false;
    document.createRange = /** @type {() => Range} */ (/** @type {unknown} */ (rangeFor));
    return true;
};

const shim = () => {
    window.__tubeInspecting = true;
    return { parentNode: shimParentNode(), range: shimRange() };
};

export { shim, rangeFor, shimParentNode, shimRange };
