const EVERY_MS = 250;

const FOR_MS = 60000;

export function waitFor(find, onFound, options) {
    const every = (options && options.everyMs) || EVERY_MS;
    const until = Date.now() + ((options && options.forMs) || FOR_MS);
    const pending = { timer: null };

    // A finder that throws against a half-built page counts as not found.
    const lookOnce = () => {
        try {
            return find();
        } catch (e) {
            return null;
        }
    };

    const look = () => {
        const found = lookOnce();

        if (found) return onFound(found);
        if (Date.now() > until) return undefined;

        pending.timer = setTimeout(look, every);
        return undefined;
    };

    look();

    return () => clearTimeout(pending.timer);
}
