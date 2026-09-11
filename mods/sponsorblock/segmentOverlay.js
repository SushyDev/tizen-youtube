import { gradientOver, stretches } from './segmentGradient.js';
import { drawnBar } from './drawnBar.js';
import { carry, nest, structureOf, wrapperFor } from './mirror.js';

// One band per chapter, because Cobalt has no clip-path to cut a single box to the bar's shape.

const OVERLAY_ID = 'tube-sponsorblock-bar';

const RADII = [
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-right-radius', 'border-bottom-left-radius'
];

const identityOf = (bar) => bar.pieces
    .map(({ element, span }) => `${element.getAttribute('idomkey')}@${span.from}-${span.to}`)
    .join('|');

const bandFor = (piece, all, at) => {
    const gradient = gradientOver(all, piece.span);
    if (!gradient) return null;

    const element = document.createElement('div');

    element.style.setProperty('position', 'absolute', 'important');
    element.style.setProperty('background-image', gradient, 'important');

    return { element, at, written: {} };
};

// Vertical edges round outwards so a half-pixel chapter is fully covered.
const place = (band, piece, shift) => {
    const { element, written } = band;
    const { box } = piece;

    const top = Math.floor(box.top - shift.y);

    const wants = {
        left: `${box.left - shift.x}px`,
        top: `${top}px`,
        width: `${box.width}px`,
        height: `${Math.ceil(box.bottom - shift.y) - top}px`
    };

    Object.keys(wants)
        .filter((name) => written[name] !== wants[name])
        .forEach((name) => element.style.setProperty(name, wants[name], 'important'));

    const { className } = piece.element;
    const placed = { element, at: band.at, written: Object.assign({}, wants, { className }) };

    if (written.className === className) return placed;

    const drawn = getComputedStyle(piece.element);
    RADII.forEach((corner) => {
        element.style.setProperty(corner, drawn.getPropertyValue(corner) || '0px', 'important');
    });

    return placed;
};

const segmentOverlay = (segments) => {
    const held = {
        video: null, root: null, wrappers: [], inner: null, bands: [],
        identity: null, structure: null, duration: null, stretches: [], frame: null
    };

    const watch = (video) => {
        if (held.video) held.video.removeEventListener('timeupdate', wake);
        held.video = video;
        video.addEventListener('timeupdate', wake);
    };

    // Anchored to the body, because the player's re-renders drop any child they did not put there.
    const build = () => {
        const root = document.createElement('div');

        root.id = OVERLAY_ID;
        root.style.setProperty('position', 'fixed', 'important');
        root.style.setProperty('left', '0px', 'important');
        root.style.setProperty('top', '0px', 'important');
        root.style.setProperty('width', '0px', 'important');
        root.style.setProperty('height', '0px', 'important');
        root.style.setProperty('pointer-events', 'none', 'important');
        root.style.setProperty('z-index', '2000', 'important');

        document.body.appendChild(root);
        return root;
    };

    const raise = (bar) => {
        Array.prototype.slice.call(held.root.children)
            .forEach((child) => held.root.removeChild(child));

        held.wrappers = bar.layers.map(wrapperFor);
        held.bands = [];
        held.identity = null;
        held.inner = nest(held.root, held.wrappers);
    };

    const clear = () => {
        held.bands.forEach((band) => held.inner.removeChild(band.element));
        held.bands = [];
        held.identity = null;
    };

    const stop = () => {
        if (held.frame !== null) cancelAnimationFrame(held.frame);
        held.frame = null;
    };

    const look = () => {
        if (!held.root || !held.video || !held.video.duration) return;

        if (held.duration !== held.video.duration) {
            held.duration = held.video.duration;
            held.stretches = stretches(segments, held.duration);
            held.identity = null;
        }

        const bar = drawnBar(held.duration);

        if (!bar) {
            if (held.bands.length) clear();
            if (held.structure !== null) stop();
            return;
        }

        const structure = structureOf(bar.layers);

        if (structure !== held.structure) {
            held.structure = structure;
            raise(bar);
        }

        held.wrappers = held.wrappers.map((wrapper, at) => carry(wrapper, bar.layers[at]));

        const identity = identityOf(bar);

        if (identity !== held.identity) {
            clear();
            held.identity = identity;

            held.bands = bar.pieces
                .map((piece, at) => bandFor(piece, held.stretches, at))
                .filter((band) => band);

            held.bands.forEach((band) => held.inner.appendChild(band.element));
        }

        held.bands = held.bands.map((band) => place(band, bar.pieces[band.at], bar.shift));
    };

    const tick = () => {
        held.frame = requestAnimationFrame(tick);
        look();
    };

    const wake = () => {
        if (held.root && held.frame === null) tick();
    };

    // Asked for again on every duration change, so it has to be idempotent.
    const show = () => {
        if (held.root) return wake();
        if (!held.video || !held.video.duration) return;
        if (!segments.length) return;

        held.root = build();
        window.addEventListener('keydown', wake, true);
        tick();
    };

    const remove = () => {
        stop();
        window.removeEventListener('keydown', wake, true);
        if (held.video) held.video.removeEventListener('timeupdate', wake);

        if (held.root && held.root.parentNode) held.root.parentNode.removeChild(held.root);

        held.root = null;
        held.wrappers = [];
        held.inner = null;
        held.bands = [];
        held.identity = null;
        held.structure = null;
        held.duration = null;
        held.video = null;
    };

    return { watch, show, remove };
};

export { segmentOverlay };
