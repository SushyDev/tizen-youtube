import { VERSION, COMMIT, TREE } from '../runtime/stamp.js';
import { send, line, describe } from './journal.js';

const state = { watching: false };

const watchPage = () => {
    if (state.watching) return;
    state.watching = true;

    window.addEventListener('error', (event) => send(line('error', `${event.message} @ ${event.filename}:${event.lineno}`)));
    window.addEventListener('unhandledrejection', (event) => send(line('rejection', describe(event.reason))));

    send(`tube: userscript ${VERSION}-${COMMIT}-${TREE} booted`);
};

export { watchPage };
