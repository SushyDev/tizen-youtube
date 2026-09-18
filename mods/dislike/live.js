import { configChangeEmitter, configRead, every, stop } from '../../framework/index.js';
import { videoIdIn } from '../sponsorblock/sponsorblock.js';
import { compact } from './api.js';
import { dislikesOf } from './store.js';

// The count label only exists in the DOM while the dislike button is focused, so a MutationObserver
// reacts the instant the tooltip's text node is inserted — a poll here was visibly slower, flashing
// "Dislike" before the count replaced it.
//
// The same tooltip element can survive a change of video and a vote can silently reset it straight
// back to native "Dislike", both confirmed live, so what is shown is checked against what it should
// be — a marker alone would miss the reset, and trusting the text alone would miss the stale video.
const BUTTON = 'ytlr-like-button-renderer';
const NAME = 'dislike live';
const MARKER = 'data-tube-dislike-for';

// The MutationObserver is what makes a swap fast, so this interval only gates re-attaching to new buttons.
const INTERVAL = 1000;

const observed = new WeakSet();

const swapIfNeeded = (el) => {
    if (!el) return;

    const videoID = videoIdIn(location.hash);
    if (!videoID) return;

    const markedFor = el.getAttribute(MARKER);
    const dislikes = dislikesOf(videoID);

    if (dislikes === undefined || dislikes === null) {
        if (markedFor !== null) {
            el.textContent = 'Dislike';
            el.removeAttribute(MARKER);
        }
        return;
    }

    const expected = compact(dislikes);
    if (markedFor === videoID && el.textContent === expected) return;
    if (markedFor === null && el.textContent !== 'Dislike') return;

    el.textContent = expected;
    el.setAttribute(MARKER, videoID);
};

const textElementsIn = (button) => Array.from(button.querySelectorAll('yt-formatted-string'));

// The tooltip's text can arrive as the added node itself, as an ancestor of it in the same
// batch, or (should the node already exist and only its text change) as a text node whose
// parent is what needs checking.
const scanForText = (node) => {
    if (node.nodeType === 3) return swapIfNeeded(node.parentElement);
    if (node.nodeType !== 1) return;

    if (node.tagName === 'YT-FORMATTED-STRING') swapIfNeeded(node);
    if (node.querySelectorAll) textElementsIn(node).forEach(swapIfNeeded);
};

const attach = (button) => {
    if (observed.has(button)) return;
    observed.add(button);

    scanForText(button);

    const observer = new MutationObserver((mutations) => {
        // NodeList has no forEach on this engine, so results are read through Array.from.
        Array.from(mutations).forEach((mutation) => {
            if (mutation.type === 'characterData') return scanForText(mutation.target);
            Array.from(mutation.addedNodes).forEach(scanForText);
        });
    });

    observer.observe(button, { childList: true, subtree: true, characterData: true });
};

const sweep = () => Array.from(document.querySelectorAll(BUTTON)).forEach((button) => {
    attach(button);
    textElementsIn(button).forEach(swapIfNeeded);
});

const sync = () => {
    if (configRead('enableReturnDislike')) every(NAME, INTERVAL, sweep);
    else stop(NAME);
};

sync();

configChangeEmitter.addEventListener('configChange', (event) => {
    if (event.detail.key === 'enableReturnDislike') sync();
});
