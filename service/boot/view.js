import { diag, help, written } from './config.js';
import { held } from './state.js';
import { showCard } from './card.js';
import { elapsed } from './clock.js';
import { TIMING } from './timing.js';
import { lastRunSays } from './trail.js';

const bare = (url) => String(url || '').replace(/^https?:\/\//, '');

const sentence = (text) => {
    const said = String(text || '');
    return said ? `${said.charAt(0).toUpperCase()}${said.slice(1)}.` : '';
};

const POWER = 'Hold the power button on the remote until the Samsung logo shows (standby is not enough), then open Tube again.';

const lastStep = (phone) => {
    if (held.code) return 'Still stuck? Post the code on the right in the Discord.';
    if (phone) return 'Still stuck? Scan the code on the right with your phone and tap Send to support.';
    return `Still stuck? Post a photo of this whole screen in the Discord: ${bare(help.discord)}`;
};

// The diag page is served by the service, so it is only offered while something is answering.
const diagAside = () => ({ label: 'Scan for help', qr: diag, shownUrl: bare(diag) });

const helpAside = () => {
    if (held.code) return { label: 'Post this code in Discord', code: held.code, qr: held.reportUrl, shownUrl: bare(help.discord) };
    if (held.upload === 'sending') return { label: 'Sending a report…' };

    return { label: 'Scan to ask on Discord', qr: help.discord, shownUrl: bare(help.discord) };
};

// Offered when the failure says something is listening: a timeout or an error status rather than a refusal.
export const phoneCanHelp = () => held.seen || !!held.serving
    || (!!held.failure && held.failure !== 'refused');

const calm = (head, detail, aside) => ({ tone: 'calm', head, detail, aside });

const failed = (head, detail, steps, aside) => ({ tone: 'bad', head, detail, steps, aside });

const answering = () => {
    if (held.blockedOut) {
        return failed('YouTube doesn\'t load through Tube', 'Tube\'s service is running, but YouTube does not answer through it.', [
            'Close Tube with a long press on Back and open it again. If the stock YouTube app is open, close it the same way first.',
            POWER,
            lastStep(true)
        ], held.code ? helpAside() : diagAside());
    }

    if (held.badWaiting) {
        const network = /reachable/.test(held.badWaiting);

        return failed(network ? 'Can\'t reach YouTube' : 'Tube could not start', sentence(held.badWaiting), [
            network ? 'Check the TV is online: does another app that streams video work?' : 'Close Tube with a long press on Back and open it again.',
            POWER,
            lastStep(true)
        ], held.code ? helpAside() : diagAside());
    }

    if (held.handed) return { tone: 'ok', head: 'Opening YouTube', detail: 'Everything answered. Handing over now.' };
    if (held.probed) return calm('Connecting to YouTube', 'YouTube has not answered through Tube yet. This can take a moment.', diagAside());

    return calm('Starting Tube', held.waiting && held.waiting !== 'the service'
        ? sentence(held.waiting)
        : 'The background service answered. Checking the connection to YouTube.', diagAside());
};

const silent = () => {
    if (!held.silentStuck) {
        if (held.answeredOnce) return calm('Starting Tube', 'Tube\'s background service stopped answering. Waiting for it to come back.');
        if (elapsed() > TIMING.slow) return calm('Still starting', 'Right after the TV is switched on this can take up to a minute. Nothing to do yet.');
        return calm('Starting Tube', 'Waiting for Tube\'s background service. This usually takes a few seconds.');
    }

    if (phoneCanHelp()) {
        return failed('Tube\'s background service isn\'t answering', 'It is there but not responding, so YouTube can\'t load.', [
            'Close Tube with a long press on Back and open it again.',
            POWER,
            lastStep(true)
        ], held.code ? helpAside() : diagAside());
    }

    return failed('Tube\'s background service isn\'t running', lastRunSays() || 'The TV didn\'t start the part of Tube that loads YouTube, so there is nothing to show yet.', [
        POWER,
        'Right after switching on, the TV can take a minute to start it: wait, then open Tube again.',
        lastStep(false)
    ], helpAside());
};

export const refresh = () => {
    const card = held.seen || held.handed ? answering() : silent();
    const patch = held.patch || (written && written.patch);

    showCard(Object.assign({ version: patch ? `Tube ${patch}` : 'Tube' }, card));
};
