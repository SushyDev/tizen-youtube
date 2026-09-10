import { SEGMENTS } from './segments.js';

// The segments, drawn over the timeline.
//
// Three things were tried on the set before this shape survived, and each ruled out the next:
//
//   1. A div appended into the track, which the next incremental-DOM patch dropped — it appeared
//      for a few seconds and vanished, most visibly on a seek. Nothing of ours survives anywhere
//      in the player's tree; build() has the measurement.
//   2. A `::after` pseudo-element, which no DOM patch could remove. Cobalt renders no pseudo-
//      elements at all: a probe giving `::after` a 37px box measured 0. Measured, not assumed.
//   3. Elements anchored to document.body — outside the player's model entirely — held over the
//      chapters' own rectangles. linear-gradient is supported, so a band carries every segment
//      that crosses it and the colours keep their alpha, letting the grey track and the played
//      portion read through rather than covering them.
//
// One band per chapter, for two separate reasons.
//
// The bar is not a rectangle. It is one div per chapter with a gap between them, and the chapter
// under the playhead is rounded and — while the bar has focus — taller than its neighbours. Cobalt
// implements no clip-path, standard or prefixed (measured: both serialise to nothing), so a single
// box cannot be cut to that shape. One band per chapter already is that shape.
//
// And time does not run evenly across the bar. Each chapter is drawn `width` px wide for a stretch
// of timeline that is `width + gap` px, and YouTube fits the chapter's whole time range into the
// narrower box — so a chapter's own start and end are what its pixels are a fraction of, never the
// duration of the video. Reading the geometry and assuming otherwise put every band up to 6px
// right of where it belonged, drifting further with each chapter passed. YouTube settles this
// itself: at 64.21s of a 0-110s chapter drawn 273px wide, its own played fill measures 159px,
// which is the chapter's rule (159.4) and not the timeline's (162.9).

const OVERLAY_ID = 'tube-sponsorblock-bar';

// Both, so a build that still uses the older name keeps working.
const TRACK = 'ytlr-multi-markers-player-bar-renderer div[idomkey="progress-bar"], div[idomkey="slider"]';

// How the bands move with the bar, which took three wrong answers to get right.
//
// Hiding the controls is three animations on three elements at once. Measured on the set:
// `transform` and `opacity` over 200ms on yt-focus-container, `opacity` over 500ms on
// ytlr-progress-bar, and `transform`/`opacity` over 200ms on the track — on two different curves.
// The 48px the bar drops is a translateY on yt-focus-container, and the opacity a viewer sees is
// the product of two eased curves of different lengths.
//
// The first answer was to read what the engine had composed, every frame, and copy it. It cannot
// work here, and the reason is worth writing down: **Cobalt's getComputedStyle answers with the
// value a transition is heading for, not the value it is showing.** A probe gave an element
// `opacity 0 -> 1` over 400ms; `transitionend` arrived at 399ms, so the animation genuinely ran,
// while forty-three frames of getComputedStyle all read `1`. Traces of the real bar say the same:
// 219 frames across a show, a focus and a hide, and three distinct readings. Nothing that samples
// can see these animations, at any rate.
//
// What the engine will do is run a transition of ours. So the bands do not follow the bar; they are
// given the same instructions and animate beside it. Every ancestor that would ease opacity or
// transform is mirrored by an empty box of ours carrying that ancestor's own declaration, nested in
// the order they nest, and the bands sit at the bottom of that stack — so two opacities compose
// into a product the way theirs do, and the slide is a transform on a wrapper rather than something
// recomputed per frame. A chapter's measured position has the mirrored translation taken back off
// it, because the mirror is about to put it there.
//
// requestAnimationFrame remains, but only to notice a new target promptly — the engine draws the
// curve. It holds 60.8fps on the set with a worst gap of 19ms.

// The pieces the bar is drawn as. A chaptered video draws one div per chapter; a video without
// chapters draws the single full-width `segment` div instead.
const CHAPTER = 'chapter-';
const WHOLE_BAR = 'div[idomkey="segment"]';

// A highlight marks a point rather than covering a stretch, so it is drawn as a thin band.
const POINT_WIDTH = 0.4;

// Copied from the chapter each band covers, because the chapter under the playhead is a rounded
// pill and the ends of the bar are rounded too. This is also the only clipping this engine has.
const RADII = [
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-right-radius', 'border-bottom-left-radius'
];

const barFor = (segment) => SEGMENTS[segment.category] || { color: '#0000ff', opacity: 0.7 };

// The palette is hex because the bars used to be elements carrying their own opacity. A gradient
// stop carries its own alpha instead, so the two are folded into one colour here.
const rgba = (hex, opacity) => {
    const found = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
    if (!found) return hex;

    const channels = [found[1], found[2], found[3]].map((pair) => parseInt(pair, 16));
    return `rgba(${channels.join(', ')}, ${opacity})`;
};

// Every segment as one stretch of time in one colour, in the order they run. A point marker covers
// no time of its own, so it is given a narrow stretch here rather than at the drawing.
const stretches = (segments, duration) => segments
    .map((segment) => {
        const bar = barFor(segment);

        return {
            colour: rgba(bar.color, bar.opacity),
            from: segment.segment[0],
            to: segment.category === 'poi_highlight'
                ? segment.segment[0] + (duration * POINT_WIDTH) / 100
                : segment.segment[1]
        };
    })
    .filter((stretch) => stretch.to > stretch.from)
    .sort((one, two) => one.from - two.from);

// Hard stops on both edges of every stretch, so each is a band rather than a fade. CSS clamps a
// stop that would run backwards, which is what keeps overlapping segments from tearing the ramp.
//
// Everything is a fraction of the one span this piece covers. A segment running off either end is
// clamped to the edge and drawn again by the piece next door — which is what lets one sponsor
// cross a chapter boundary, meet itself on the far side, and leave the gap between them bare.
const gradientOver = (all, span) => {
    const across = span.to - span.from;
    if (!(across > 0)) return '';

    const stops = all.reduce((kept, stretch) => {
        const from = ((stretch.from - span.from) / across) * 100;
        const to = ((stretch.to - span.from) / across) * 100;

        if (to <= 0 || from >= 100) return kept;

        const left = Math.max(0, from);
        const right = Math.min(100, to);

        return kept.concat([
            `transparent ${left}%`, `${stretch.colour} ${left}%`,
            `${stretch.colour} ${right}%`, `transparent ${right}%`
        ]);
    }, []);

    return stops.length ? `linear-gradient(to right, ${stops.join(', ')})` : '';
};

// The whole timeline as one span, which is what a caller outside this file means by a gradient.
const gradientFor = (segments, duration) => gradientOver(
    stretches(segments, duration), { from: 0, to: duration }
);

// Found by walking the children rather than by selector. Cobalt's querySelectorAll implements no
// prefix or substring attribute match: on the set `[idomkey^="chapter-"]` answers 0 where
// `[idomkey]` answers 10 and `[idomkey="chapter-0"]` answers 1. That is why nothing was ever
// drawn — the overlay was built, sized from an empty list, and hidden on every tick it ever ran.
const piecesOf = (track) => {
    const chapters = Array.prototype.slice.call(track.children)
        .filter((kid) => String(kid.getAttribute('idomkey') || '').indexOf(CHAPTER) === 0);

    if (chapters.length) return chapters;

    const whole = track.querySelector(WHOLE_BAR);
    return whole ? [whole] : [];
};

// The chapter a chapter div draws, which is where its times come from. YouTube hangs it on the
// element itself: `{ start, end, index, offset, width }`, under names it has not obfuscated.
const chapterIn = (element) => {
    const instance = element.__instance;
    const chapter = instance && instance.props && instance.props.chapter;

    if (!chapter || typeof chapter.start !== 'number' || !(chapter.end > chapter.start)) return null;

    return { from: chapter.start, to: chapter.end };
};

// The time each piece covers. YouTube's own numbers wherever the pieces still carry them, and
// failing that the piece's own position along the track — which is the same answer but for the gap
// it cannot account for, and is the difference between a tint a few pixels out and no tint at all.
// It is also how the single full-width piece of a video without chapters is answered: one piece,
// starting at the left edge, running to the end.
const spansFor = (pieces, track, duration) => {
    const carried = pieces.map(({ element }) => chapterIn(element));
    if (carried.every((span) => span)) return carried;

    const edge = (box) => ((box.left - track.left) / track.width) * duration;

    return pieces.map(({ box }, at) => ({
        from: edge(box),
        to: at + 1 < pieces.length ? edge(pieces[at + 1].box) : duration
    }));
};

// Splitting on the commas that separate one transition from the next, and not on the ones inside a
// timing function — `cubic-bezier(0.25,0.1,0.25,1)` is three commas of its own.
const commaParts = (text) => {
    const held = String(text).split('').reduce((state, letter) => {
        if (letter === '(') return { depth: state.depth + 1, parts: state.parts, current: state.current + letter };
        if (letter === ')') return { depth: state.depth - 1, parts: state.parts, current: state.current + letter };
        if (letter === ',' && state.depth === 0) return { depth: 0, parts: state.parts.concat([state.current]), current: '' };

        return { depth: state.depth, parts: state.parts, current: state.current + letter };
    }, { depth: 0, parts: [], current: '' });

    return held.parts.concat([held.current]).map((part) => part.trim()).filter((part) => part);
};

// The longhands put back together, because a band is given the declaration whole.
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

// Whether this element's own transition would move opacity or transform if either changed. Asked
// of every ancestor, and asked whether or not anything is moving right now: a mirror has to be in
// place carrying the old value before the new one arrives, or the engine has nothing to interpolate
// from and our band snaps while the bar glides.
const animatesMotion = (style) => {
    const names = commaParts(style.transitionProperty);
    const times = commaParts(style.transitionDuration);

    return names.some((name, at) => MOVING.indexOf(name) !== -1
        && (times[at] || times[0]) && (times[at] || times[0]) !== '0s');
};

// The ancestors that animate, outermost first, each as the three values worth copying. Measured on
// the set there are exactly three: the track and yt-focus-container move transform and opacity over
// 200ms on two different curves, and ytlr-progress-bar fades opacity over 500ms on a third.
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

// Only the translation, because that is all these layers do with a transform and all a band needs
// taking off its position. Anything else is left at nothing, which costs the slide and no more.
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

// Everything the mirrored layers move the bar by, which is what has to come off a chapter's
// measured position before a band is put at it — the mirror will put it back.
const shiftOf = (layers) => layers.reduce((all, layer) => {
    const step = translateOf(layer.transform);
    return { x: all.x + step.x, y: all.y + step.y };
}, { x: 0, y: 0 });

// The bar as the viewer sees it: every piece it is drawn as, the span of time each stands for, the
// layers between it and the page, and what those layers have moved it by.
const drawnBar = (duration) => {
    const track = document.querySelector(TRACK);
    if (!track) return null;

    const rect = track.getBoundingClientRect();
    if (!(rect.width > 0)) return null;

    const pieces = piecesOf(track)
        .map((element) => ({ element, box: element.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.height > 0);

    if (!pieces.length) return null;

    const spans = spansFor(pieces, rect, duration);
    const layers = layersAbove(track, []);

    return {
        layers,
        shift: shiftOf(layers),
        pieces: pieces.map((piece, at) => ({ element: piece.element, box: piece.box, span: spans[at] }))
    };
};

// What is on the bar right now: which pieces there are, and the stretch of time each covers. Only a
// change here needs new bands — moving and fading are the mirror's business, not theirs.
const identityOf = (bar) => bar.pieces
    .map(({ element, span }) => `${element.getAttribute('idomkey')}@${span.from}-${span.to}`)
    .join('|');

// Which layers are being mirrored, and on what terms. New wrappers are only built when this
// changes, because rebuilding them mid-fade would restart every transition they are running.
const mirrorOf = (bar) => bar.layers.map((layer) => layer.transition).join(' || ');

// One layer of the mirror: an empty box carrying one ancestor's opacity, transform and transition,
// so the engine interpolates ours exactly as it interpolates theirs and composes them the same way.
const wrapperFor = (layer) => {
    const element = document.createElement('div');

    element.style.setProperty('position', 'absolute', 'important');
    element.style.setProperty('left', '0px', 'important');
    element.style.setProperty('top', '0px', 'important');
    element.style.setProperty('width', '0px', 'important');
    element.style.setProperty('height', '0px', 'important');
    element.style.setProperty('transition', layer.transition, 'important');
    element.style.setProperty('opacity', layer.opacity, 'important');
    element.style.setProperty('transform', layer.transform, 'important');

    return { element, written: { opacity: layer.opacity, transform: layer.transform } };
};

// One band, carrying the segments that cross one piece of the bar. It has no transition of its own:
// everything that eases is above it, and what is left — a chapter growing under the playhead — is
// something YouTube does instantly too (`transition: all 0s` on the chapters themselves).
const bandFor = (piece, all) => {
    const gradient = gradientOver(all, piece.span);
    if (!gradient) return null;

    const element = document.createElement('div');

    element.style.setProperty('position', 'absolute', 'important');
    element.style.setProperty('background-image', gradient, 'important');

    return { element, written: {} };
};

// Where a band sits, in the space underneath the mirror.
//
// The vertical edges are taken outwards to whole pixels. A chapter is 75% of a 12px track offset by
// 4.5px, so it lives on a half pixel — 757.5 to 766.5 — and a band matching that exactly is a
// separate composited layer being asked to rasterise the same half pixel, which it does not do the
// same way. The tint came up a hair short, most visibly along the bottom edge. Half a pixel of
// overhang lands on the transparent air around the bar and covers the seam. Horizontal edges are
// left alone: chapter lefts and widths are already whole numbers, and widening a band would move
// every gradient stop inside it.
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

    const moved = Object.keys(wants).filter((name) => written[name] !== wants[name]);

    moved.forEach((name) => {
        written[name] = wants[name];
        element.style.setProperty(name, wants[name], 'important');
    });

    // The corners change when a chapter becomes the active one or stops being it, which is a class
    // change and nothing geometric — so the class is what is watched, and the four radii are read
    // back from the engine only when it has really changed.
    if (written.className === piece.element.className) return;

    written.className = piece.element.className;

    const drawn = getComputedStyle(piece.element);
    RADII.forEach((corner) => {
        element.style.setProperty(corner, drawn.getPropertyValue(corner) || '0px', 'important');
    });
};

const segmentOverlay = (segments) => {
    const held = {
        video: null, root: null, wrappers: [], inner: null, bands: [],
        identity: null, mirror: null, duration: null, stretches: [], frame: null
    };

    const watch = (video) => {
        held.video = video;
    };

    // Zero-sized and anchored to the body: a handle for taking everything away at once, not a box
    // anything is drawn in.
    //
    // Outside the player's tree because there is nowhere inside it to stand. Every one of the seven
    // ancestors between the track and the watch page was given a probe on the set; within one 250ms
    // sample of the controls coming up, all seven were gone. Incremental DOM re-renders the whole
    // controls subtree and takes every child it did not put there with it — so this is true not only
    // of the track, whose chapters are rewritten on each tick, but of the fading ancestors too.
    // Which is why the fade has to be rebuilt out here rather than inherited from in there.
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

    // The mirror: one empty box per animating ancestor, nested in the order they are nested, with
    // the bands at the bottom of the stack. Built once and then only written to.
    const raise = (bar) => {
        Array.prototype.slice.call(held.root.children)
            .forEach((child) => held.root.removeChild(child));

        held.wrappers = bar.layers.map(wrapperFor);
        held.bands = [];
        held.identity = null;

        held.inner = held.wrappers.reduce((parent, wrapper) => {
            parent.appendChild(wrapper.element);
            return wrapper.element;
        }, held.root);
    };

    // Each mirrored layer given whatever its ancestor is now showing. Setting a value the engine is
    // already transitioning towards is not a new transition, so this is safe to call every frame;
    // setting a new one starts ours on the same curve, at most a frame behind theirs.
    const carry = (bar) => held.wrappers.forEach((wrapper, at) => {
        const layer = bar.layers[at];
        if (!layer) return;

        ['opacity', 'transform'].forEach((name) => {
            if (wrapper.written[name] === layer[name]) return;

            wrapper.written[name] = layer[name];
            wrapper.element.style.setProperty(name, layer[name], 'important');
        });
    });

    const clear = () => {
        held.bands.forEach((band) => held.inner.removeChild(band.element));
        held.bands = [];
        held.identity = null;
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
            return;
        }

        const mirror = mirrorOf(bar);

        if (mirror !== held.mirror) {
            held.mirror = mirror;
            raise(bar);
        }

        carry(bar);

        const identity = identityOf(bar);

        if (identity !== held.identity) {
            clear();
            held.identity = identity;

            held.bands = bar.pieces
                .map((piece, at) => {
                    const band = bandFor(piece, held.stretches);
                    return band && Object.assign(band, { at });
                })
                .filter((band) => band);

            held.bands.forEach((band) => held.inner.appendChild(band.element));
        }

        held.bands.forEach((band) => place(band, bar.pieces[band.at], bar.shift));
    };

    // Every frame, but only to notice. The engine will not say what a transition is part way
    // through — asked mid-fade it answers with the value the fade is heading for — so there is no
    // curve here to follow and nothing gained by looking more carefully. What a frame buys is
    // hearing about a new target promptly: our transition then starts within about 16ms of theirs
    // and runs on the same declaration, which is what keeps the two in step.
    const tick = () => {
        held.frame = requestAnimationFrame(tick);
        look();
    };

    // Asked for again on every duration change, so it has to be idempotent.
    const show = () => {
        if (held.root) return;
        if (!held.video || !held.video.duration) return;
        if (!segments.length) return;

        held.root = build();
        tick();
    };

    const remove = () => {
        if (held.frame !== null) cancelAnimationFrame(held.frame);
        held.frame = null;

        if (held.root && held.root.parentNode) held.root.parentNode.removeChild(held.root);

        held.root = null;
        held.wrappers = [];
        held.inner = null;
        held.bands = [];
        held.identity = null;
        held.mirror = null;
        held.duration = null;
        held.video = null;
    };

    return { watch, show, remove };
};

export {
    segmentOverlay,
    gradientFor, gradientOver, stretches, chapterIn, spansFor,
    commaParts, transitionOf, animatesMotion, translateOf, shiftOf
};
