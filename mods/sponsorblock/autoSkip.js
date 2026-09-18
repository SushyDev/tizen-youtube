import { configRead, showToast } from '../../framework/index.js';
import { nameOf } from './segments.js';
import { repeatGuard } from './repeatGuard.js';

const LEAD = 0.3;

// Seeking flush with the video end triggers the end screen, so stop short of it.
const TAIL = 1;

const announce = (text) => {
    if (configRead('enableSponsorBlockToasts')) showToast('SponsorBlock', text);
};

// `skippable` and `manualOnly` are read once per video; a change applies from the next one.
const autoSkipper = (segments, skippable, manualOnly) => {
    const held = { video: null, timeout: null, active: true };
    const repeats = repeatGuard();

    const watch = (video) => {
        held.video = video;
    };

    // Landing mid-way into a second segment that overlaps the one just skipped is jarring, so the
    // jump follows the chain of overlapping auto-skip segments out to whichever's end is furthest.
    // Recurses because one pass only reaches segments that overlap the start; a segment overlapping
    // only the extended end needs a further pass to be picked up.
    const latestEndOf = (segment) => {
        const autoSkippable = segments.filter((candidate) =>
            skippable.indexOf(candidate.category) !== -1 && manualOnly.indexOf(candidate.category) === -1);

        const extend = (end) => {
            const stretched = autoSkippable.reduce((furthest, other) => {
                const [otherStart, otherEnd] = other.segment;
                return otherStart < furthest && otherEnd > furthest ? otherEnd : furthest;
            }, end);

            return stretched === end ? end : extend(stretched);
        };

        const [, end] = segment.segment;
        return extend(end);
    };

    const jump = (segment) => {
        const skipName = nameOf(segment);

        if (manualOnly.indexOf(segment.category) !== -1) return;

        const judged = repeats.judge(segment.UUID, Date.now());

        if (judged.repeated) {
            if (judged.announce) {
                announce(`Not skipping ${skipName} (was skipped ${judged.count} times)`);
            }
            return;
        }

        announce(`Skipping ${skipName}`);

        const end = latestEndOf(segment);
        held.video.currentTime = held.video.duration - end < TAIL ? end - TAIL : end;
        schedule();
    };

    // The lead counts a segment the playhead has just entered as ahead, so a seek into the middle of one still skips.
    function schedule() {
        clearTimeout(held.timeout);
        held.timeout = null;

        if (!held.active || held.video.paused) return;

        const ahead = segments
            .filter((segment) => segment.segment[0] > held.video.currentTime - LEAD
                && segment.segment[1] > held.video.currentTime - LEAD)
            .sort((one, two) => one.segment[0] - two.segment[0]);

        if (!ahead.length) return;

        const [segment] = ahead;
        const [start] = segment.segment;

        // A setTimeout counts real time, but `start` is video time, so the wait is scaled by
        // playback rate — at 2x speed the video reaches `start` in half the real-time delay.
        const rate = held.video.playbackRate || 1;

        held.timeout = setTimeout(() => {
            if (held.video.paused) return;
            if (skippable.indexOf(segment.category) === -1) return;

            jump(segment);
        }, ((start - held.video.currentTime) * 1000) / rate);
    }

    const finish = () => {
        held.active = false;

        clearTimeout(held.timeout);
        held.timeout = null;

        repeats.clear();
        held.video = null;
    };

    return { watch, schedule, finish };
};

export { autoSkipper };
