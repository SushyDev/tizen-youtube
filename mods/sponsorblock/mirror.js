// Empty boxes nested as the bar's ancestors nest, so their visibility composes the same way.

// Cobalt 20 reports where a transition will end rather than where it is, and eases our copies on
// its own clock: a mirrored fade lagged by seconds, and a mirrored slide drifted further the longer
// it ran. The bar is measured every frame instead, so every copy is written as it stands, without easing.
const still = (layer) => Object.assign({}, layer, { transition: 'none', transform: 'none' });

// Transition first, so the change written after it is cut by the new declaration.
const CARRIED = ['transition', 'transform', 'visibility'];

// Opacity goes on the bands themselves: Cobalt 20 does not fade what a box of no size holds
// outside itself.
const FADED = ['transition', 'opacity'];

const carry = (wrapper, layer, names) => {
    const carried = names || CARRIED;
    const stood = still(layer);

    carried
        .filter((name) => wrapper.written[name] !== stood[name])
        .forEach((name) => wrapper.element.style.setProperty(name, stood[name], 'important'));

    const written = carried.reduce((all, name) => Object.assign({}, all, { [name]: stood[name] }), {});
    return { element: wrapper.element, written };
};

const opacityOf = (layer) => (layer.opacity === '' || isNaN(Number(layer.opacity)) ? 1 : Number(layer.opacity));

// The opacity every ancestor's together gives.
const fadeOf = (layers) => ({
    opacity: String(layers.reduce((all, layer) => all * opacityOf(layer), 1)),
    transition: 'none'
});

const fade = (band, layers) => carry(band, fadeOf(layers), FADED);

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

// Rebuilt only when the ancestors change, since a new box starts at its end value and a fade begun in the same frame arrives as a jump.
const structureOf = (layers) => layers.map((layer) => layer.name).join(' < ');

export { carry, fade, fadeOf, wrapperFor, nest, structureOf };
