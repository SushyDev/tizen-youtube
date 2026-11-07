import { supportUrl, written } from './config.js';
import { held } from './state.js';
import { post } from './request.js';
import { engine } from './engine.js';
import { elapsed } from './clock.js';
import { say } from './screen.js';

const report = () => ({
    source: 'boot screen',
    engine: engine(),
    agent: navigator.userAgent || '',
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    written,
    waited: Math.round(elapsed()),
    answered: held.answeredOnce,
    failure: held.failure,
    elsewhere: held.elsewhere,
    waiting: held.badWaiting || held.waiting,
    facts: held.factsSeen || null,
    log: held.lines
});

const codeOf = (text) => {
    try {
        const body = JSON.parse(text);
        return body && body.code ? body : null;
    } catch (e) {
        return null;
    }
};

// Sent once per page, so a stuck screen hands the viewer a code to post instead of a photo.
export const sendReport = (then) => {
    if (!supportUrl || held.upload) return;
    held.upload = 'sending';
    then();

    const body = JSON.stringify({ app: 'youtube', version: (written && written.patch) || held.patch || 'unknown', report: report() });

    post(`${supportUrl}/api/reports`, body, (status, text) => {
        const answer = status >= 200 && status < 300 ? codeOf(text) : null;

        if (answer) {
            held.upload = 'sent';
            held.code = answer.code;
            held.reportUrl = answer.url || '';
            say('tube', `report sent: post code ${answer.code} in the Discord`, 'note');
        } else {
            held.upload = 'failed';
            say('tube', `the report could not be sent (${status || 'no answer'}): post a photo of this screen instead`, 'warn');
        }

        then();
    });
};
