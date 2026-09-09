// The two loosenings a debugger needs from this engine, and what each one is worth.
//
// The parentNode one is the reason the Elements panel ever drew. kabuki instruments
// Text.prototype.data with a setter whose last two lines walk through this.parentNode, and every
// node a debugger builds is detached at the moment it is first written to — so DOM.enable, the
// first DOM command of a session, threw and the panel stayed empty every time. Reproduced here in
// the shape it has on the set: the assignment lands, the bookkeeping after it does not.
//
// The range one is smaller: this engine has no Range and no document.createRange whatsoever.

import assert from 'assert';

const PARENTS = new Map();

// Stands in for Node.prototype, whose parentNode getter is configurable on the set — which is the
// only reason any of this is possible, since Text.prototype.data is not.
const nodePrototype = {};

Object.defineProperty(nodePrototype, 'parentNode', {
    configurable: true,
    enumerable: false,
    get: function parentNode() { return PARENTS.get(this) || null; }
});

const BOX = { top: 10, left: 20, right: 120, bottom: 40, width: 100, height: 30 };

const elementFor = () => {
    const element = Object.create(nodePrototype);

    element.nodeType = 1;
    element.appendChild = (child) => { PARENTS.set(child, element); return child; };
    element.removeChild = (child) => { PARENTS.delete(child); return child; };
    element.getBoundingClientRect = () => BOX;

    return element;
};

const textFor = (text) => {
    const node = Object.create(nodePrototype);
    const marker = elementFor();

    node.nodeType = 3;
    node.textContent = text;

    Object.defineProperty(node, 'data', {
        configurable: false,
        get: function data() { return this.textContent; },
        set: function data(value) {
            this.textContent = value;
            this.parentNode.appendChild(marker);
            this.parentNode.removeChild(marker);
        }
    });

    return node;
};

global.window = {};
global.document = {
    createElement: elementFor,
    createDocumentFragment: () => ({ nodeType: 11 })
};
global.Node = { prototype: nodePrototype };

const { shim, rangeFor, shimParentNode, shimRange } = await import('../mods/dev/domShims.js');

const results = [];

const check = (name, run) => {
    try {
        run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 5).join('\n      ')}`);
    }
};

// What it was like before, so a later change that quietly stops shimming is a failure here rather
// than an empty panel on the television.
check('the defect: writing to a detached node throws through parentNode', () => {
    assert.throws(() => { textFor('before').data = 'written'; });
});

check('a parentNode that cannot be wrapped is left exactly as it is', () => {
    const sealed = {};
    Object.defineProperty(sealed, 'parentNode', { configurable: false, get: () => null });

    global.Node = { prototype: sealed };
    const shimmed = shimParentNode();
    global.Node = { prototype: nodePrototype };

    assert.strictEqual(shimmed, false);
    assert.strictEqual(Object.getOwnPropertyDescriptor(sealed, 'parentNode').configurable, false);
});

check('a value property where a getter was expected is refused too', () => {
    global.Node = { prototype: { parentNode: null } };
    const shimmed = shimParentNode();
    global.Node = { prototype: nodePrototype };

    assert.strictEqual(shimmed, false);
});

check('shim() arms the flag and reports both halves', () => {
    assert.deepStrictEqual(shim(), { parentNode: true, range: true });
    assert.strictEqual(window.__tubeInspecting, true);
});

check('the defect is gone: the same write now lands', () => {
    const node = textFor('before');
    node.data = 'written';
    assert.strictEqual(node.textContent, 'written');
});

check('a detached text node is lent one throwaway parent, not one each', () => {
    const first = textFor('one').parentNode;
    const second = textFor('two').parentNode;

    assert.ok(first, 'no parent was lent');
    assert.strictEqual(first.nodeType, 1);
    assert.strictEqual(first, second);
});

check('a node that really has a parent still reports that one', () => {
    const parent = elementFor();
    const node = textFor('attached');
    parent.appendChild(node);

    assert.strictEqual(node.parentNode, parent);
});

check('only text nodes are lied to — a detached element is still parentless', () => {
    assert.strictEqual(elementFor().parentNode, null);
});

check('nothing is loosened while no inspector is attached', () => {
    window.__tubeInspecting = false;
    const detached = textFor('quiet').parentNode;
    window.__tubeInspecting = true;

    assert.strictEqual(detached, null);
});

check('an engine that already has createRange keeps its own', () => {
    assert.strictEqual(shimRange(), false);
});

check('a range answers with the node it was given', () => {
    const range = rangeFor();
    const node = textFor('selected');

    assert.strictEqual(range.collapsed, true);
    range.selectNode(node);

    assert.strictEqual(range.startContainer, node);
    assert.strictEqual(range.endContainer, node);
    assert.strictEqual(range.collapsed, false);
});

check('setStart, setEnd and collapse move the same two ends', () => {
    const range = rangeFor();
    const start = textFor('start');
    const end = textFor('end');

    range.setStart(start);
    range.setEnd(end);
    assert.strictEqual(range.startContainer, start);
    assert.strictEqual(range.endContainer, end);

    range.collapse();
    assert.strictEqual(range.collapsed, true);
});

// A debugger measures a text node by measuring what holds it — the node has no box of its own.
check('a range over a text node is measured through the element holding it', () => {
    const range = rangeFor();
    const node = textFor('measured');
    node.parentElement = elementFor();

    range.selectNodeContents(node);

    assert.deepStrictEqual(range.getBoundingClientRect(), BOX);
    assert.deepStrictEqual(range.getClientRects(), [BOX]);
});

check('a range over an element is measured directly', () => {
    const range = rangeFor();
    range.selectNode(elementFor());

    assert.deepStrictEqual(range.getBoundingClientRect(), BOX);
});

check('a range with nothing to measure answers a zero box rather than throwing', () => {
    const range = rangeFor();
    assert.deepStrictEqual(range.getBoundingClientRect(),
        { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });

    range.selectNode(textFor('loose'));
    assert.strictEqual(range.getBoundingClientRect().width, 0);
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
