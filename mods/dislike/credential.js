// A persistent anonymous identity Return YouTube Dislike uses to attribute votes, generated once
// and never tied to any YouTube or Google account.

const KEY = 'tube.dislikeCredential';
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const LENGTH = 36;

const generateUserId = () => {
    const values = new Uint32Array(LENGTH);
    crypto.getRandomValues(values);
    return Array.from(values).map((value) => CHARSET[value % CHARSET.length]).join('');
};

const credential = () => {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(KEY) || 'null');
        return parsed && typeof parsed.userId === 'string' && parsed.confirmed === true ? parsed : null;
    } catch (error) {
        return null;
    }
};

const remember = (userId) => {
    try {
        window.localStorage.setItem(KEY, JSON.stringify({ userId, confirmed: true }));
    } catch (error) {
    }
};

const forget = () => {
    try {
        window.localStorage.removeItem(KEY);
    } catch (error) {
    }
};

export { generateUserId, credential, remember, forget };
