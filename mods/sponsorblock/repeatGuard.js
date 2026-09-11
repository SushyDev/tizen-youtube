// Stops skipping a segment the viewer re-enters within WINDOW ms, and says so once.

const WINDOW = 1000;

const repeatGuard = () => {
    const seen = new Map();

    // Returns what the caller should do: skip it, or leave it — and whether this is the moment to
    // say why. `announce` is true exactly once per segment, however many times it repeats after.
    const judge = (uuid, now) => {
        const before = seen.get(uuid);

        if (!before) {
            seen.set(uuid, { count: 1, firstSkipped: now, lastSkipped: now, announced: false });
            return { repeated: false, announce: false, count: 1 };
        }

        const record = Object.assign({}, before, { count: before.count + 1, lastSkipped: now });
        seen.set(uuid, record);

        if (record.lastSkipped - record.firstSkipped >= WINDOW) return { repeated: false, announce: false, count: record.count };

        if (record.announced) return { repeated: true, announce: false, count: record.count };

        seen.set(uuid, Object.assign({}, record, { announced: true }));
        return { repeated: true, announce: true, count: record.count };
    };

    const clear = () => seen.clear();

    return { judge, clear };
};

export { repeatGuard, WINDOW };
