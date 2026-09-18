import { get } from './request.js';
import { bootUrl } from './urls.js';
import { held } from './state.js';
import { outgoing, sent } from './outbox.js';
import { heard } from './heard.js';
import { silent } from './silent.js';

const parsed = (status, text) => {
    if (status !== 200) return null;

    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
};

export const poll = () => {
    const sending = outgoing();

    get(bootUrl(sending, held.serving), (status, text, how) => {
        const body = parsed(status, text);
        if (!body) return silent(poll, status, how);

        sent(sending.length);
        return heard(body, poll);
    });
};
