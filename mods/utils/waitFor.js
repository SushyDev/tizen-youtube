// Wait for something the page has not built yet.
//
// This was written eleven times across the userscript, in two shapes and with no agreement on how
// long to keep asking. Most of them never stopped: a page that never grows a video element polled
// four times a second for as long as it was open, and every config change started another one.

const EVERY = 250;

// Long enough that a slow set still gets there, short enough that a page which never will stops
// costing anything.
const GIVE_UP_AFTER = 60000;

export function waitFor(find, onFound, options) {
    const every = (options && options.every) || EVERY;
    const until = Date.now() + ((options && options.forMs) || GIVE_UP_AFTER);
    const pending = { timer: null };

    const look = () => {
        const found = (() => {
            try {
                return find();
            } catch (e) {
                return null;
            }
        })();

        if (found) return onFound(found);
        if (Date.now() > until) return undefined;

        pending.timer = setTimeout(look, every);
        return undefined;
    };

    look();

    return () => clearTimeout(pending.timer);
}
