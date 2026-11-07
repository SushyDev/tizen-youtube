import { diag, help, service, written } from './config.js';
import { held } from './state.js';
import { showCard } from './card.js';
import { elapsed } from './clock.js';
import { TIMING } from './timing.js';
import { lastRunSays } from './trail.js';
import { autoLaunch } from './settings.js';

const bare = (url) => String(url || '').replace(/^https?:\/\//, '');

const sentence = (text) => {
    const said = String(text || '');
    if (!said) return '';

    // A host name keeps its own case.
    return /^\S+\.\S+/.test(said) ? `${said}.` : `${said.charAt(0).toUpperCase()}${said.slice(1)}.`;
};

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

const POWER = 'Hold the remote\'s power button until the Samsung logo shows (standby is not enough), then open Tube again.';

const lastStep = (phone) => {
    if (held.code) return 'Still stuck? Post the code on the right in the Discord.';
    if (phone) return 'Still stuck? Scan the code on the right with your phone and tap Send to support.';
    return `Still stuck? Post a photo of this whole screen in the Discord: ${bare(help.discord)}`;
};

// Offered when the failure says something is listening: a timeout or an error status rather than a refusal.
export const phoneCanHelp = () => held.seen || !!held.serving
    || (!!held.failure && held.failure !== 'refused');

const diagAside = () => ({ label: 'Help on your phone', qr: diag, shownUrl: bare(diag) });

const helpAside = () => {
    if (held.code) return { label: 'Post this code in Discord', code: held.code, qr: held.reportUrl, shownUrl: bare(help.discord) };
    if (held.upload === 'sending') return { label: 'Sending a report…' };

    return { label: 'Scan to ask on Discord', qr: help.discord, shownUrl: bare(help.discord) };
};

// The diag page is served by the service, so it is only offered while something is answering.
const aside = () => {
    if (held.code || held.upload === 'sending') return helpAside();
    if (phoneCanHelp()) return diagAside();
    return held.silentStuck ? helpAside() : null;
};

const check = (name, state, text) => ({ name, state, text });

const heardFrom = () => held.seen || held.answeredOnce;

const serviceCheck = () => {
    const name = 'Background service';

    if (held.restarting) return check(name, 'pending', 'Restarting…');
    if (held.seen) return check(name, 'ok', `Answered in ${seconds(held.answeredAt)}`);
    if (held.silentStuck) return check(name, 'bad', phoneCanHelp() ? 'There, but not answering' : `Not running: nothing answers at ${bare(service)}`);
    if (held.answeredOnce) return check(name, 'pending', 'Stopped answering, waiting for it to come back');

    return check(name, 'pending', `Waiting… ${Math.round(elapsed() / 1000)} s`);
};

const containerCheck = () => {
    const name = 'YouTube container';
    const cobalt = held.cobalt;

    if (!heardFrom()) return check(name, 'idle', 'Waits for the service');
    if (cobalt && cobalt.failed) return check(name, 'bad', cobalt.failed);
    if (cobalt && !cobalt.settled) return check(name, 'pending', 'Preparing…');

    return check(name, 'ok', 'Ready');
};

const throughCheck = () => {
    const name = 'YouTube through Tube';

    if (!heardFrom() || (held.cobalt && held.cobalt.failed)) return check(name, 'idle', 'Waits for the container');
    if (held.badWaiting) return check(name, 'bad', sentence(held.badWaiting));
    if (held.blockedOut) return check(name, 'bad', 'No answer through the service');
    if (held.through) return check(name, 'ok', `Answered in ${seconds(held.throughMs)}`);
    if (held.probed) return check(name, 'pending', `No answer yet, trying again (${held.probed})`);
    if (held.waiting && held.waiting !== 'the service') return check(name, 'pending', sentence(held.waiting));

    return check(name, 'pending', 'Checking…');
};

export const checks = () => [serviceCheck(), containerCheck(), throughCheck()];

export const allReady = () => checks().every((one) => one.state === 'ok');

// What a press on Launch does: false while the service cannot take it.
export const canLaunch = () => held.seen && !held.restarting;

const calm = (head, detail) => ({ tone: 'calm', head, detail });

const failed = (head, detail, steps) => ({ tone: 'bad', head, detail, steps });

const answering = (found) => {
    if (held.blockedOut) {
        return failed('YouTube doesn\'t load through Tube', 'Tube\'s service is running, but YouTube does not answer through it.', [
            'Close Tube with a long press on Back and open it again. If the stock YouTube app is open, close it the same way first.',
            POWER,
            lastStep(true)
        ]);
    }

    if (held.cobalt && held.cobalt.failed) {
        return failed('Tube could not start', sentence(`the service could not prepare Cobalt: ${held.cobalt.failed}`), [
            'Close Tube with a long press on Back and open it again.', POWER, lastStep(true)
        ]);
    }

    if (held.badWaiting) {
        const network = /reachable/.test(held.badWaiting);

        return failed(network ? 'Can\'t reach YouTube' : 'Tube could not start', network
            ? 'Usually the TV\'s network. Tube checks again every few seconds.'
            : 'Tube\'s service hit a problem while starting.', [
            network ? 'Check the TV is online: does another app that streams video work?' : 'Close Tube with a long press on Back and open it again.',
            POWER,
            lastStep(true)
        ]);
    }

    if (found.every((one) => one.state === 'ok')) {
        return held.launching ? calm('Opening YouTube', 'Everything answered.') : { tone: 'ok', head: 'Ready', detail: 'Everything answered. Press OK on Launch YouTube.' };
    }

    if (held.probed) return calm('Connecting to YouTube', 'YouTube has not answered through Tube yet. This can take a moment.');
    if (held.launching) return calm('Starting Tube', 'YouTube opens as soon as everything is ready.');

    return calm('Getting ready', held.waiting && held.waiting !== 'the service'
        ? sentence(held.waiting)
        : 'The background service answered. Checking the connection to YouTube.');
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
        ]);
    }

    return failed('Tube\'s background service isn\'t running', lastRunSays() || 'The TV didn\'t start the part of Tube that loads YouTube, so there is nothing to show yet.', [
        POWER,
        'Right after switching on, the TV can take a minute to start it: wait, then open Tube again.',
        lastStep(false)
    ]);
};

const state = (found) => {
    if (held.handed && held.slowHandover) {
        return calm('Still opening YouTube', 'YouTube hasn\'t loaded yet. Keep waiting, or go back to the launcher and try again.');
    }
    if (held.handed) return { tone: 'ok', head: 'Opening YouTube', detail: 'Everything answered. Handing over now.' };
    if (held.restarting) return calm('Restarting Tube\'s service', 'It comes back on its own in a few seconds.');

    return held.seen ? answering(found) : silent();
};

const button = (id, label, extra) => Object.assign({ id, label }, extra || {});

const launchButton = (found) => {
    const ready = found.filter((one) => one.state === 'ok').length;

    if (ready === found.length) return button('launch', 'Launch YouTube', { primary: true });
    if (canLaunch() && found.some((one) => one.state === 'bad')) return button('launch', 'Launch anyway', { primary: true });
    if (!held.seen) return button('launch', 'Launch YouTube', { primary: true, off: true, sub: ' · needs the service' });

    return button('launch', 'Launch YouTube', { primary: true, off: true, sub: ` · ${ready} of ${found.length} ready` });
};

const buttons = (found) => {
    if (held.handed) return [button('stop', 'Back to launcher', { primary: true })];
    if (held.launching) return [button('stop', 'Stop', { primary: true }), button('logs', 'Logs')];

    const restart = held.restarting
        ? [button('restart', 'Restarting service…', { off: true })]
        : (held.seen ? [button('restart', 'Restart service')] : []);

    return [launchButton(found), button('logs', 'Logs')].concat(restart)
        .concat([button('auto', 'Auto-launch', { value: autoLaunch() ? 'On' : 'Off' })]);
};

const hint = () => {
    if (held.handed) return 'Back stops here and shows the launcher.';
    if (held.launching) return 'OK on Stop, or Back, stops here and shows the launcher.';
    return '';
};

// The first button that takes a press, until the viewer moves somewhere else.
const focusOf = (shown) => {
    const usable = shown.filter((one) => !one.off).map((one) => one.id);

    if (!held.moved || usable.indexOf(held.focus) === -1) held.focus = usable[0] || '';
    return held.focus;
};

const platformOf = () => {
    const tizen = (held.factsSeen && held.factsSeen.tizen) || ((/Tizen (\d+(?:\.\d+)?)/.exec(navigator.userAgent || '') || [])[1]);
    return tizen ? `Tizen ${tizen}` : '';
};

export const model = () => {
    const found = checks();
    const shown = buttons(found);
    const patch = held.patch || (written && written.patch);
    const focus = focusOf(shown);

    return Object.assign({
        view: held.view,
        version: patch ? `Tube ${patch}` : 'Tube',
        platform: platformOf(),
        checks: found,
        buttons: shown.map((one) => Object.assign({}, one, { focus: one.id === focus })),
        hint: hint(),
        aside: held.handed ? null : aside(),
        logsHead: 'Logs · OK or Back returns to the launcher'
    }, state(found));
};

export const refresh = () => showCard(model());
