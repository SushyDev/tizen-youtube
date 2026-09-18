// Read from aria-pressed, not likeStatus — that JSON never reaches interception on this engine.
import { configRead } from '../../framework/index.js';
import { videoIdIn } from '../sponsorblock/index.js';
import { requestVote } from './sync.js';

const BUTTON = 'YTLR-LIKE-BUTTON-RENDERER';
const ENTER = 13;
const SETTLE_AFTER = 350;

const within = (el, tag) => {
    if (!el) return false;
    if (el.tagName === tag) return true;
    return within(el.parentElement, tag);
};

// Scoped to yt-button-container — its icon idomkey matches first and has no aria-pressed of its own.
const isDislikePressed = () => {
    const button = document.querySelector('yt-button-container[idomkey="dislike-button"]');
    return !!button && button.getAttribute('aria-pressed') === 'true';
};

const isLikePressed = () => {
    const button = document.querySelector('yt-button-container[idomkey="like-button"]');
    return !!button && button.getAttribute('aria-pressed') === 'true';
};

const voteValue = () => {
    if (isDislikePressed()) return -1;
    if (isLikePressed()) return 1;
    return 0;
};

const onPress = (event) => {
    if (event.keyCode !== ENTER || !within(event.target, BUTTON)) return;
    if (!configRead('enableReturnDislike')) return;

    const videoId = videoIdIn(location.hash);
    if (!videoId) return;

    setTimeout(() => requestVote(videoId, voteValue()), SETTLE_AFTER);
};

document.addEventListener('keydown', onPress, true);

export { within, voteValue };
