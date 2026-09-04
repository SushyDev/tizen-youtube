import { note } from '../dev/journal.js';
import { objectURLFor } from '../youtube/mediaSource.js';

const AHEAD_SECONDS = 24;
const BEHIND_SECONDS = 12;

const LOOK_EVERY = 250;

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

function trackOf(session, kind, origin) {
    const described = session[kind];

    return {
        kind,
        described,
        buffer: null,
        next: described.first,
        last: described.first + described.segments - 1,
        appendedMs: 0,
        address: (number) => `${origin}/dash/${session.id}/${kind}/${number === 0 ? 'init.mp4' : `${number}.m4s`}`,
        type: `${described.mimeType}; codecs="${described.codecs}"`
    };
}

// Televisions built on Cobalt take parameters on the codec string, and this one asks the
// platform to flush its decoder when the playhead moves. The reference client appends it to
// every codec string it hands to `addSourceBuffer`, and on this hardware it is the
// difference between a seek working and a seek that reports success and changes nothing:
// measured here on the native path, a seek completes — `seeked` fires, `seeking` clears,
// `readyState` stays 4, seconds of decodable media sit ahead of the playhead — and the
// decoder goes on showing the picture it already had, asking for nothing further. There is
// no way to ask for that flush except through the codec string, which is why it can only be
// done from here and not from a plain `src`.
//
// A build that does not know the parameter may refuse the type outright, and an unplayable
// video is worse than an unflushed seek, so a refusal falls back to the plain type.
const FLUSH_ON_SEEK = '; enableflushduringseek=true';

function added(source, type) {
    try {
        return source.addSourceBuffer(type + FLUSH_ON_SEEK);
    } catch (e) {
        note('feeder', `the set would not take the seek-flush hint (${e.name || 'refused'}); `
            + `adding ${type} plainly`);

        return source.addSourceBuffer(type);
    }
}

export function feed(session, origin) {
    if (typeof window === 'undefined' || !window.MediaSource) return null;

    const tracks = ['video', 'audio'].map((kind) => trackOf(session, kind, origin));

    const unsupported = tracks.filter((track) => !window.MediaSource.isTypeSupported(track.type));
    if (unsupported.length) {
        note('feeder', `not supported here: ${unsupported.map((one) => one.type).join(', ')}`);
        return null;
    }

    const source = new window.MediaSource();

    // The browser's own, not the replacement: the patched one would hand back whatever this
    // is being asked to produce.
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
        try {
            source.duration = session.durationMs / 1000;
        } catch (e) {
            // Some builds refuse this until a buffer exists; the buffered ranges still work.
        }

        Promise.all(tracks.map(async (track) => {
            track.buffer = added(source, track.type);
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

    const ahead = (track) => {
        const video = document.querySelector('video');
        const at = video ? video.currentTime : 0;
        const ranges = track.buffer.buffered;

        for (let n = 0; n < ranges.length; n++) {
            if (ranges.start(n) <= at + 0.1 && ranges.end(n) > at) return ranges.end(n) - at;
        }

        return ranges.length ? 0 : 0;
    };

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
