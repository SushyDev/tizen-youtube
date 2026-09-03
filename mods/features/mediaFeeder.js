import { note } from '../dev/journal.js';
import { objectURLFor } from '../youtube/mediaSource.js';

// The same media, fed to the element through a MediaSource this app drives itself.
//
// Handing the element a URL is what makes the picture smooth here: the platform decodes it
// and scans it out to a hardware overlay, and nothing in the web engine ever touches a
// frame. That is also why nothing can count them — every counter reads zero, a canvas comes
// back black, and the one switch that makes the renderer count stops the platform playing a
// URL at all. On a television whose whole purpose is to play 2160p60 cleanly, "we cannot
// tell you whether it drops frames" is not a good enough answer.
//
// Through MediaSource the engine does the decoding, so it counts. YouTube's own use of it
// drops four frames in a hundred at 2160p60 — but that is *its* use of it: small appends,
// its own eviction, its own adaptive churn. What this does instead is append whole segments,
// keep a deep buffer, never change format mid-stream and never evict ahead of the player.
// Whether that is smooth is the question, and either answer is worth having: smooth means a
// pipeline that is both good and measurable, and rough means the engine's decode is the
// fault rather than YouTube's handling of it, which closes the question for good.

// How far ahead of the player to keep the buffer, and how much of the past to keep. Both
// generous: memory is not the constraint here, and a deep buffer is the point.
const AHEAD_SECONDS = 24;
const BEHIND_SECONDS = 12;

// How often to look at whether more is wanted. Appending is driven by how much is buffered
// rather than by a timer, so this only decides how promptly that is noticed.
const LOOK_EVERY = 250;

/** A source buffer's `updateend`, as something that can be waited for. */
const settled = (buffer) => new Promise((done, failed) => {
    if (!buffer.updating) return done();

    const finish = () => {
        buffer.removeEventListener('updateend', finish);
        buffer.removeEventListener('error', broke);
        done();
    };

    const broke = (event) => {
        buffer.removeEventListener('updateend', finish);
        buffer.removeEventListener('error', broke);
        failed(new Error(`source buffer refused an append: ${event.type}`));
    };

    buffer.addEventListener('updateend', finish);
    buffer.addEventListener('error', broke);

    return undefined;
});

/** One track: where its segments come from, and how far through them this has got. */
function trackOf(session, kind, origin) {
    const described = session[kind];

    return {
        kind,
        described,
        buffer: null,
        // The segment to append next, and where in the video it will land.
        next: described.first,
        last: described.first + described.segments - 1,
        appendedMs: 0,
        address: (number) => `${origin}/dash/${session.id}/${kind}/${number === 0 ? 'init.mp4' : `${number}.m4s`}`,
        // What the element has to be told the bytes are, before it will take any.
        type: `${described.mimeType}; codecs="${described.codecs}"`
    };
}

/**
 * Feeds one video into a MediaSource, and answers with the address to hand the element.
 *
 * Returns null where the platform will not take the formats being served, which is the
 * signal to hand over something else instead — there is no use pointing the element at a
 * source that will never accept a byte.
 */
export function feed(session, origin) {
    if (typeof window === 'undefined' || !window.MediaSource) return null;

    const tracks = ['video', 'audio'].map((kind) => trackOf(session, kind, origin));

    const unsupported = tracks.filter((track) => !window.MediaSource.isTypeSupported(track.type));
    if (unsupported.length) {
        note('feeder', `not supported here: ${unsupported.map((one) => one.type).join(', ')}`);
        return null;
    }

    const source = new window.MediaSource();

    // The browser's own, not the replacement: asking the patched one would hand back
    // whatever this is being asked to produce.
    const address = objectURLFor(source);
    if (!address) return null;

    let stopped = false;
    let looking = null;

    const stop = () => {
        stopped = true;
        clearInterval(looking);
    };

    source.addEventListener('sourceclose', stop);

    source.addEventListener('sourceopen', () => {
        // Set once and never changed: an element told how long the video runs can seek
        // across the whole of it rather than only across what has been appended.
        try {
            source.duration = session.durationMs / 1000;
        } catch (e) {
            // Some builds refuse this until a buffer exists; the buffered ranges still work.
        }

        Promise.all(tracks.map(async (track) => {
            track.buffer = source.addSourceBuffer(track.type);
            track.buffer.mode = 'segments';

            const init = await fetch(track.address(0)).then((r) => r.arrayBuffer());
            track.buffer.appendBuffer(init);
            await settled(track.buffer);
        })).then(() => {
            note('feeder', `feeding ${session.videoId}: ${tracks.map((one) => `${one.kind} ${one.described.itag}`).join(', ')}`);
            looking = setInterval(pour, LOOK_EVERY);
            pour();
        }, (failure) => {
            note('feeder', `could not start: ${failure.message}`);
            stop();
        });
    });

    /** How much is buffered ahead of where the element is playing. */
    const ahead = (track) => {
        const video = document.querySelector('video');
        const at = video ? video.currentTime : 0;
        const ranges = track.buffer.buffered;

        for (let n = 0; n < ranges.length; n++) {
            if (ranges.start(n) <= at + 0.1 && ranges.end(n) > at) return ranges.end(n) - at;
        }

        // Nothing covering the moment being played: whatever is there is not usable yet.
        return ranges.length ? 0 : 0;
    };

    /** Drops what is well behind, so a long video does not grow without limit. */
    const forget = async (track) => {
        const video = document.querySelector('video');
        const at = video ? video.currentTime : 0;
        const until = at - BEHIND_SECONDS;
        if (until <= 0 || track.buffer.updating) return;

        const ranges = track.buffer.buffered;
        if (!ranges.length || ranges.start(0) >= until) return;

        track.buffer.remove(ranges.start(0), until);
        await settled(track.buffer);
    };

    let pouring = false;

    async function pour() {
        if (stopped || pouring) return;
        pouring = true;

        try {
            for (const track of tracks) {
                if (stopped || !track.buffer) continue;
                if (track.next > track.last) continue;
                if (track.buffer.updating) continue;
                if (ahead(track) >= AHEAD_SECONDS) continue;

                const number = track.next;
                const bytes = await fetch(track.address(number)).then((r) => {
                    if (!r.ok) throw new Error(`segment ${number}: ${r.status}`);
                    return r.arrayBuffer();
                });

                if (stopped) return;

                track.buffer.appendBuffer(bytes);
                await settled(track.buffer);

                track.next += 1;
                await forget(track);
            }

            // Every track has appended everything it has, so the video is complete.
            if (!stopped && tracks.every((one) => one.next > one.last)
                && tracks.every((one) => !one.buffer.updating)
                && source.readyState === 'open') {
                source.endOfStream();
                stop();
            }
        } catch (failure) {
            note('feeder', `stopped: ${failure.message}`);
            stop();
        } finally {
            pouring = false;
        }
    }

    return { address, stop };
}
