// Empty boxes standing in for the bar's ancestors, nested as they nest, so their opacities compose
// into a product the way YouTube's do.

// Transition first, so the change written after it is eased or cut by the new declaration, as
// YouTube's own is.
const CARRIED = ['transition', 'opacity', 'transform', 'visibility'];

const carry = (wrapper, layer) => {
    CARRIED
        .filter((name) => wrapper.written[name] !== layer[name])
        .forEach((name) => wrapper.element.style.setProperty(name, layer[name], 'important'));

    const written = CARRIED.reduce((all, name) => Object.assign({}, all, { [name]: layer[name] }), {});
    return { element: wrapper.element, written };
};

const wrapperFor = (layer) => {
    const element = document.createElement('div');

    element.style.setProperty('position', 'absolute', 'important');
    element.style.setProperty('left', '0px', 'important');
    element.style.setProperty('top', '0px', 'important');
    element.style.setProperty('width', '0px', 'important');
    element.style.setProperty('height', '0px', 'important');

    return carry({ element, written: {} }, layer);
};

const nest = (parent, wrappers) => {
    if (!wrappers.length) return parent;

    parent.appendChild(wrappers[0].element);
    return nest(wrappers[0].element, wrappers.slice(1));
};

// Rebuilt only when the ancestors change: a new box starts at the value it is heading for, so a
// fade beginning in the same frame would arrive as a jump.
const structureOf = (layers) => layers.map((layer) => layer.name).join(' < ');

export { carry, wrapperFor, nest, structureOf };
