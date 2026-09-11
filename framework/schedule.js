// Named timers: rescheduling a name replaces its timer rather than stacking a second.

const timers = Object.create(null);

const stop = (name) => {
    const held = timers[name];
    if (!held) return;

    clearTimeout(held.timer);
    clearInterval(held.timer);
    timers[name] = null;
};

const guarded = (name, run) => {
    try {
        run();
    } catch (failure) {
        console.error(`[schedule:${name}] failed:`, failure);
    }
};

const every = (name, ms, tick) => {
    stop(name);
    timers[name] = { timer: setInterval(() => guarded(name, tick), ms) };
    return () => stop(name);
};

const after = (name, ms, run) => {
    stop(name);
    timers[name] = {
        timer: setTimeout(() => {
            timers[name] = null;
            guarded(name, run);
        }, ms)
    };
    return () => stop(name);
};

// Repeats, then gives itself up. Calling it again while it is running extends the deadline rather
// than starting a second timer — which is what the adoption window needs on every navigation.
const until = (name, ms, tick, forMs) => {
    const deadline = Date.now() + forMs;
    const held = timers[name];

    if (held && held.until !== undefined) {
        held.until = Math.max(held.until, deadline);
        return () => stop(name);
    }

    stop(name);

    const record = {
        until: deadline,
        timer: setInterval(() => {
            guarded(name, tick);
            if (Date.now() > record.until) stop(name);
        }, ms)
    };

    timers[name] = record;
    return () => stop(name);
};

const running = (name) => !!timers[name];

export { every, after, until, stop, running };
