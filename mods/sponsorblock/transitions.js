// Top-level commas only, because a timing function such as cubic-bezier() has commas of its own.
const commaParts = (text) => {
    const parsed = String(text).split('').reduce((state, letter) => {
        if (letter === '(') return { depth: state.depth + 1, parts: state.parts, current: state.current + letter };
        if (letter === ')') return { depth: state.depth - 1, parts: state.parts, current: state.current + letter };
        if (letter === ',' && state.depth === 0) return { depth: 0, parts: state.parts.concat([state.current]), current: '' };

        return { depth: state.depth, parts: state.parts, current: state.current + letter };
    }, { depth: 0, parts: [], current: '' });

    return parsed.parts.concat([parsed.current]).map((part) => part.trim()).filter((part) => part);
};

const CARRIED = ['opacity', 'transform', 'visibility', 'all'];

const secondsIn = (time) => {
    const found = /^(-?[\d.]+)(m?s)$/.exec(String(time).trim());
    if (!found) return 0;

    return found[2] === 'ms' ? Number(found[1]) / 1000 : Number(found[1]);
};

const cycled = (list, index) => (list.length ? list[index % list.length] : '');

// Normalised, because it is compared every frame and rewritten only when it differs.
const transitionOf = (style) => {
    const times = commaParts(style.transitionDuration);
    const curves = commaParts(style.transitionTimingFunction);
    const waits = commaParts(style.transitionDelay);

    const kept = commaParts(style.transitionProperty)
        .map((name, at) => ({ name, time: cycled(times, at), curve: cycled(curves, at), wait: cycled(waits, at) }))
        .filter(({ name }) => CARRIED.indexOf(name) !== -1)
        .filter(({ time, wait }) => secondsIn(time) > 0 || secondsIn(wait) > 0)
        .map(({ name, time, curve, wait }) => [name, time, curve, wait].join(' ').trim());

    return kept.length ? kept.join(', ') : 'none';
};

const SLIDE = /^translate[XY]?\(\s*-?[\d.]+px\s*(,\s*-?[\d.]+px\s*)?\)$/;

// A translation lands the same on a box of no size in the corner of the screen; a scale or a
// percentage does not. YouTube hides the bar before it scales the player behind a panel.
const slideOf = (transform) => {
    const parts = String(transform || '').match(/[\w-]+\([^)]*\)/g) || [];
    return parts.length && parts.every((part) => SLIDE.test(part)) ? parts.join(' ') : 'none';
};

const nameOf = (node) => {
    const key = node.getAttribute('idomkey');
    const tag = node.tagName.toLowerCase();

    return key ? `${tag}[${key}]` : tag;
};

// Every ancestor, not only the moving ones, because YouTube also hides the bar with no transition
// at all. Cobalt's getComputedStyle reports a transition's end value, so they are mirrored, not
// sampled.
const layersAbove = (node, found) => {
    if (!node || !node.tagName || node === document.body) return found;

    const style = getComputedStyle(node);

    return layersAbove(node.parentNode, [{
        name: nameOf(node),
        opacity: style.opacity,
        transform: slideOf(style.transform),
        visibility: style.visibility,
        transition: transitionOf(style)
    }].concat(found));
};

const PIXELS = /-?[\d.]+(?=px)/g;

const stepOf = (part) => {
    const values = (part.match(PIXELS) || []).map(Number);

    if (part.indexOf('translateX(') === 0) return { x: values[0] || 0, y: 0 };
    if (part.indexOf('translateY(') === 0) return { x: 0, y: values[0] || 0 };

    return { x: values[0] || 0, y: values[1] || 0 };
};

const translateOf = (transform) => (String(transform || '').match(/translate[XY]?\([^)]*\)/g) || [])
    .map(stepOf)
    .reduce((all, step) => ({ x: all.x + step.x, y: all.y + step.y }), { x: 0, y: 0 });

// Taken off each chapter's measured position, because the mirror applies it again.
const shiftOf = (layers) => layers.reduce((all, layer) => {
    const step = translateOf(layer.transform);
    return { x: all.x + step.x, y: all.y + step.y };
}, { x: 0, y: 0 });

export { commaParts, transitionOf, slideOf, layersAbove, translateOf, shiftOf };
