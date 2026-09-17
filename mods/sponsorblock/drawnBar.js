import { layersAbove, shiftOf } from './transitions.js';

// Both names, because older builds still use the other one.
const TRACK = 'ytlr-multi-markers-player-bar-renderer div[idomkey="progress-bar"], div[idomkey="slider"]';

const CHAPTER = 'chapter-';
const WHOLE_BAR = 'div[idomkey="segment"]';

const BAR_HOSTS = ['YTLR-PROGRESS-BAR', 'YTLR-MULTI-MARKERS-PLAYER-BAR-RENDERER'];

// Walked by hand: Cobalt 20 has no Element.closest.
const insideTheBar = (element, depth) => {
    if (!element || depth === 0) return false;
    if (BAR_HOSTS.indexOf(String(element.tagName).toUpperCase()) !== -1) return true;

    return insideTheBar(element.parentElement, depth - 1);
};

// Walked by hand: Cobalt's querySelectorAll has no prefix attribute match.
const piecesOf = (track) => {
    const chapters = Array.prototype.slice.call(track.children)
        .filter((kid) => String(kid.getAttribute('idomkey') || '').indexOf(CHAPTER) === 0);

    if (chapters.length) return chapters;

    const whole = track.querySelector(WHOLE_BAR);
    if (whole) return [whole];

    // The plain slider and the decorated bar have neither chapters nor a segment.
    return insideTheBar(track.parentElement, 8) ? [track] : [];
};

const chapterIn = (element) => {
    const instance = element.__instance;
    const chapter = instance && instance.props && instance.props.chapter;

    if (!chapter || typeof chapter.start !== 'number' || !(chapter.end > chapter.start)) return null;

    return { from: chapter.start, to: chapter.end };
};

// A chapter fits its time into a box narrower than its share of the track, so its own times win where every piece carries them.
const spansFor = (pieces, trackBox, duration) => {
    const carried = pieces.map(({ element }) => chapterIn(element));
    if (carried.every((span) => span)) return carried;

    const edge = (box) => ((box.left - trackBox.left) / trackBox.width) * duration;

    return pieces.map(({ box }, at) => ({
        from: edge(box),
        to: at + 1 < pieces.length ? edge(pieces[at + 1].box) : duration
    }));
};

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

export { drawnBar, chapterIn, spansFor, piecesOf };
