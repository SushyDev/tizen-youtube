import { configRead, showToast } from '../../framework/index.js';
import { SEGMENTS } from './segments.js';
import { repeatGuard } from './repeatGuard.js';

// Jumping the stretches the viewer asked not to see.
//
// One timer, set for the start of the next segment ahead of the playhead and reset on every play,
// pause and time update. A timer rather than a check per frame: seeking, pausing and looping all
// move the playhead without warning, and re-deciding on each of those is cheaper and more exact
// than watching the clock.

const LEAD = 0.3;

// A segment ending flush with the video ends the video, so it stops just short of it: the last
// second is where the end screen and the next-video card live.
const TAIL = 1;

const nameOf = (segment) => SEGMENTS[segment.category]?.name || segment.category;

const announce = (text) => {
    if (configRead('enableSponsorBlockToasts')) showToast('SponsorBlock', text);
};

// `skippable` and `manualOnly` are fixed when a video starts, which is when they were read before:
// a category turned off mid-video takes effect on the next one.
const autoSkipper = (segments, skippable, manualOnly) => {
    const held = { video: null, timeout: null, active: true };
    const repeats = repeatGuard();

    const watch = (video) => {
        held.video = video;
    };

    const jump = (segment) => {
        const [, end] = segment.segment;
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

        held.video.currentTime = held.video.duration - end < TAIL ? end - TAIL : end;
        schedule();
    };

    // Segments still ahead of the playhead, nearest first. The lead lets a segment the playhead has
    // only just entered still count as ahead, which is what makes a seek into the middle of one
    // still skip.
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

        held.timeout = setTimeout(() => {
            if (held.video.paused) return;
            if (skippable.indexOf(segment.category) === -1) return;

            jump(segment);
        }, (start - held.video.currentTime) * 1000);
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
