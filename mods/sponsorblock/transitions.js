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

const transitionOf = (style) => {
    const names = commaParts(style.transitionProperty);
    const times = commaParts(style.transitionDuration);
    const curves = commaParts(style.transitionTimingFunction);
    const waits = commaParts(style.transitionDelay);
    const at = (list, index) => list[index] || list[0] || '';

    return names
        .map((name, index) => [name, at(times, index), at(curves, index), at(waits, index)].join(' ').trim())
        .join(', ');
};

const MOVING = ['opacity', 'transform', 'all'];

const animatesMotion = (style) => {
    const names = commaParts(style.transitionProperty);
    const times = commaParts(style.transitionDuration);

    return names.some((name, at) => MOVING.indexOf(name) !== -1
        && (times[at] || times[0]) && (times[at] || times[0]) !== '0s');
};

// Cobalt's getComputedStyle reports a transition's end value, so ancestor transitions are
// mirrored, not sampled.
const layersAbove = (node, found) => {
    if (!node || !node.tagName || node === document.body) return found;

    const style = getComputedStyle(node);
    if (!animatesMotion(style)) return layersAbove(node.parentNode, found);

    return layersAbove(node.parentNode, [{
        opacity: style.opacity,
        transform: style.transform,
        transition: transitionOf(style)
    }].concat(found));
};

const translateOf = (transform) => {
    const text = String(transform || '');
    const pair = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(text);
    const across = /translateX\((-?[\d.]+)px\)/.exec(text);
    const down = /translateY\((-?[\d.]+)px\)/.exec(text);

    return {
        x: pair ? Number(pair[1]) : (across ? Number(across[1]) : 0),
        y: pair ? Number(pair[2]) : (down ? Number(down[1]) : 0)
    };
};

// Taken off each chapter's measured position, because the mirror applies it again.
const shiftOf = (layers) => layers.reduce((all, layer) => {
    const step = translateOf(layer.transform);
    return { x: all.x + step.x, y: all.y + step.y };
}, { x: 0, y: 0 });

export { commaParts, transitionOf, animatesMotion, layersAbove, translateOf, shiftOf };
