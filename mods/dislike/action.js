// The vote value is read from the button's own post-press aria-pressed state rather than
// `likeStatus`, since that JSON never reaches JSON.parse interception on this engine, confirmed live.
import { configRead } from '../../framework/index.js';
import { videoIdIn } from '../sponsorblock/sponsorblock.js';
import { requestVote } from './sync.js';

const BUTTON = 'YTLR-LIKE-BUTTON-RENDERER';
const ENTER = 13;
const SETTLE_AFTER = 350;

const within = (el, tag) => {
    if (!el) return false;
    if (el.tagName === tag) return true;
    return within(el.parentElement, tag);
};

// idomkey also matches the icon inside the container, which querySelector finds first and which
// has no aria-pressed of its own, confirmed live — scoped to yt-button-container for the real state.
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
