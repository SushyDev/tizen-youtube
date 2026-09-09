// What this engine and this page cannot give a debugger. Two things, both measured on the set.
//
// They are loosenings of the DOM that only make sense while something is inspecting it, which is
// why they sit behind the inspector rather than in the framework: nothing else should want them.
//
// 1. kabuki instruments Text.prototype.data, and its setter is:
//
//      set(b) { this.textContent = b; this.parentNode.appendChild(a); this.parentNode.removeChild(a); }
//
//    The assignment succeeds; the bookkeeping after it throws on a detached node, which is every
//    node a debugger builds before attaching it. That threw on DOM.enable — the first DOM command
//    — so the Elements panel was always empty. Text.prototype.data is non-configurable and cannot
//    be wrapped, but parentNode can: a detached text node is handed a throwaway parent, and those
//    two lines become harmless. Told only while the inspector is attached, because a detached node
//    claiming a parent is a lie and only one caller cannot cope with the truth.
//
// 2. There is no Range and no document.createRange at all. Enough of one to be asked for a node.
const holder = { element: null };

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
    // Deliberately partial: a Range with the handful of members a debugger asks for, on an engine
    // that has none at all. The cast says that is intended rather than overlooked.
    document.createRange = /** @type {() => Range} */ (/** @type {unknown} */ (rangeFor));
    return true;
};

const shim = () => {
    window.__tubeInspecting = true;
    return { parentNode: shimParentNode(), range: shimRange() };
};

export { shim, rangeFor, shimParentNode, shimRange };
