import { configChangeEmitter, configRead, every, stop } from '../../framework/index.js';
import { videoIdIn } from '../sponsorblock/sponsorblock.js';
import { compact } from './api.js';
import { dislikesOf } from './store.js';

// A MutationObserver catches the tooltip's text node the instant it's inserted — polling flashed "Dislike" first.
// The tooltip can survive a video change or silently reset to "Dislike" on a vote, so shown text is checked against expected.
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

// The tooltip's text can arrive as the added node, an ancestor of it, or a changed text node.
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
