// This engine's spatial focus does not survive the like/dislike renderer's own DOM rebuild on a
// vote, confirmed live as an immediate jump to Subscribe, so it is corrected here rather than
// upstream in YouTube's own renderer.
//
// Native `.focus()` only moves `document.activeElement`, confirmed live — this app's own focus
// indicator updates only in response to a real dispatched key it processes itself, so the
// correction re-presses right instead.
//
// Matched by idomkey against `yt-button-container`'s own focus class, not aria-label or a
// page-wide scan for whatever is deepest focused — confirmed live, the like button's label carries
// a live count that changes after voting, and the page-wide scan gave stale answers.
const BUTTON = 'YTLR-LIKE-BUTTON-RENDERER';
const ENTER = 13;
const RIGHT = 39;
const CHECK_AFTER = 350;
const HOP_AFTER = 350;
const MAX_HOPS = 6;
const FOCUS_CLASS = 'zylon-focus';

// This engine has no Element.prototype.closest, confirmed live — ancestors are walked by hand.
const within = (el, tag) => {
    if (!el) return false;
    if (el.tagName === tag) return true;
    return within(el.parentElement, tag);
};

const dispatchKey = (code) => ['keydown', 'keypress', 'keyup'].forEach((type) => {
    const event = new KeyboardEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { get: () => code });
    Object.defineProperty(event, 'which', { get: () => code });
    document.dispatchEvent(event);
});

const isFocused = (el) => !!el && !!el.className && String(el.className).indexOf(FOCUS_CLASS) !== -1;

const focusedOn = (idomkey) => isFocused(document.querySelector(`yt-button-container[idomkey="${idomkey}"]`));

// A generation number rather than a plain flag: a fresh press must invalidate whatever an earlier
// one is still doing, not just flip a shared switch two overlapping sequences would both read.
const guard = { generation: 0 };

const hop = (count, idomkey, generation) => {
    if (generation !== guard.generation || count >= MAX_HOPS || focusedOn(idomkey)) return;

    dispatchKey(RIGHT);
    setTimeout(() => hop(count + 1, idomkey, generation), HOP_AFTER);
};

const cancelOnOtherKey = (event) => {
    if (event.keyCode === ENTER) return;
    guard.generation += 1;
    document.removeEventListener('keydown', cancelOnOtherKey, true);
};

const arm = (event) => {
    if (event.keyCode !== ENTER) return;

    const pressed = within(event.target, BUTTON) ? event.target : null;
    if (!pressed) return;

    const idomkey = pressed.getAttribute && pressed.getAttribute('idomkey');
    if (!idomkey) return;

    guard.generation += 1;
    const generation = guard.generation;
    document.addEventListener('keydown', cancelOnOtherKey, true);

    setTimeout(() => {
        document.removeEventListener('keydown', cancelOnOtherKey, true);
        if (generation === guard.generation && !focusedOn(idomkey)) hop(0, idomkey, generation);
    }, CHECK_AFTER);
};

document.addEventListener('keydown', arm, true);

export { within, focusedOn };
