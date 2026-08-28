import './boot.css';

// Getting from "the user pressed YouTube" to YouTube.
//
// There are two ways in. When Developer Mode is on, the service relaunches
// this app under the Chrome DevTools Protocol and evaluates the userscript
// straight into youtube.com — no rewriting, no proxy, nothing between the app
// and Google. When it is off, the service serves youtube.com through a local
// proxy that splices the same script in.
//
// The rule this file is built around: **every path ends at YouTube.** The
// previous version could exit without ever arriving — it asked the service to
// inject, closed itself so the debug relaunch could take over, and if that
// relaunch then failed there was nothing left running to notice. An app that
// disappears when you open it is worse than one with no modifications at all,
// so nothing here is allowed to be a dead end: every failure falls through to
// the proxy, and a deadline catches anything that fails by not answering.

const PORT = 8099;

// Off a television there is no `tizen` object at all. That single fact
// decides where the service lives — the loopback port on a TV, this page's
// own origin in a browser, where Vite proxies to whatever is answering — and
// whether this file may exit the application, which off a TV does nothing and
// is therefore reported rather than performed.
//
// Navigating away is the other irreversible thing, and it is not decided
// here: off a TV it depends on whether anything is actually serving the page
// at the far end. See `canHandOver` below.
const platform = typeof tizen === 'undefined' ? null : tizen;
const application = platform ? platform.application.getCurrentApplication() : null;
const onTv = !!application;

const BASE = onTv ? `http://localhost:${PORT}` : '';

// Long enough for a cold service start on a slow TV, short enough that nobody
// sits looking at a log wondering whether it is stuck.
const GIVE_UP_AFTER = 20000;
const POLL_INTERVAL = 200;

// Media keys have to be claimed before the player can receive them, and the
// player does not exist yet — so it happens here, first.
const MEDIA_KEYS = [
    'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
    'MediaFastForward', 'MediaRewind', 'MediaTrackNext', 'MediaTrackPrevious',
    'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue'
];

// ── The log ───────────────────────────────────────────────────────────
//
// This is a kernel log and it is formatted as one, because the format is
// right and because a screen that is only ever seen for two seconds should
// look like something you already know how to read.
//
// dmesg's line is `[   12.345678] facility: what happened`, and all three
// parts do work. The timestamp is monotonic since power-on, right-aligned in
// a fixed column so the decimal points line up and the gaps between events
// are visible as shape rather than arithmetic. The facility says which part
// of the system is talking, which is what makes a hundred lines skimmable.
// The message is lower case and terse, because it is one of a hundred.
//
// The colours are util-linux's own roles from `dmesg.c` — the timestamp
// green, the facility brown — over the console's sixteen. See boot.css.

const startedAt = (window.performance && window.performance.now)
    ? window.performance.now()
    : Date.now();

const now = () => ((window.performance && window.performance.now)
    ? window.performance.now()
    : Date.now()) - startedAt;

const logElement = document.getElementById('log');

let handedOver = false;

// Enough to fill a 1080-line screen at this size and no more. Oldest lines
// fall off the top rather than scrolling: TV webviews handle scrollTop
// inconsistently, and the newest line must always be visible.
const MAX_LINES = 34;

/**
 * Writes one line.
 *
 * `facility` is the subsystem, as in `usb 1-1:` or `EXT4-fs (sda1):`, and is
 * the thing that makes a verbose log readable rather than a wall. `tone`
 * carries severity and is left off for the ordinary case, which is most of
 * them — a log where every line is coloured has no colour at all.
 */
const say = (facility, message, tone) => {
    if (handedOver) return;

    const line = document.createElement('div');

    const stamp = document.createElement('span');
    stamp.className = 't';
    // Six decimals and a five-wide seconds field, which is dmesg's own
    // `[%5lu.%06lu]`. The precision is real: performance.now() is
    // sub-millisecond, so these digits are measurements rather than zeroes.
    stamp.textContent = `[${(now() / 1000).toFixed(6).padStart(12, ' ')}] `;

    const subsys = document.createElement('span');
    subsys.className = 's';
    subsys.textContent = `${facility}: `;

    const body = document.createElement('span');
    if (tone) body.className = tone;
    body.textContent = message;

    line.appendChild(stamp);
    line.appendChild(subsys);
    line.appendChild(body);
    logElement.appendChild(line);

    while (logElement.childNodes.length > MAX_LINES) logElement.removeChild(logElement.firstChild);
};

// The log exists to be gone. Whatever happens next paints over a black page,
// not over a list of log lines.
const handOver = () => {
    handedOver = true;
    document.body.className = 'done';
};

// Whether there is anywhere to go.
//
// On a TV, always: the service is on loopback and the proxy URL it reports is
// its own. Off one, only the development server knows — the proxy URL points
// at localhost either way, and whether anything is there depends on how
// `npm run dev` was started. So it says, by adding `handOver` to the state as
// it passes through. See ui/dev/tube.js, which sets it when it is running the
// service itself, and does not when the state is coming from a television
// across the room or from the stand-in in ui/dev/service.js.
//
// Nothing on a TV ever sends this field, and nothing needs to.
const canHandOver = (state) => onTv || !!(state && state.handOver);

/** Reports what the TV would have done next, and stops. */
const hold = (facility, what) => {
    say(facility, what, 'note');
    say('tube', 'held — off-TV, so nothing is handed over', 'note');
    document.body.className = 'held';
};

/**
 * The last line, and the only one anybody reads twice.
 *
 * systemd ends with `Startup finished in 1.2s (kernel) + 3.4s (userspace)`
 * and it is the most useful line it prints, because it turns "that felt slow"
 * into a number and says which half was responsible. This does the same with
 * the two halves that exist here: what the shell did on its own, and how long
 * it then spent waiting for the service.
 */
const summarise = () => {
    const total = now();
    const shell = shellReadyAt;
    const service = serviceUpAt ? serviceUpAt - shellReadyAt : null;

    const parts = [`shell ${(shell / 1000).toFixed(3)}s`]
        .concat(service === null ? ['service never answered'] : [`service ${(service / 1000).toFixed(3)}s`]);

    say('tube', `startup finished in ${(total / 1000).toFixed(3)}s (${parts.join(', ')})`,
        service === null ? 'warn' : 'ok');
};

window.onerror = (message, _source, line) => say('tube', `page error: ${message} (line ${line})`, 'bad');

// ── Talking to the service ────────────────────────────────────────────

// `timeout` is a budget rather than a constant because the state poll has a
// deadline it has announced on screen. A fixed 8s request timeout means the
// last poll before a 20s deadline can run until 28s, so the log would promise
// one number and do another — and the give-up path is the one place nobody is
// watching closely enough to notice it lied.
const ask = (path, timeout) => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', BASE + path, true);
    request.timeout = timeout || 8000;

    request.onload = () => {
        try {
            resolve(JSON.parse(request.responseText));
        } catch (e) {
            reject(new Error(`${path} did not return JSON`));
        }
    };

    request.onerror = () => reject(new Error('unreachable'));
    request.ontimeout = () => reject(new Error('timeout'));
    request.send();
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── What this thing is running on ─────────────────────────────────────

// The engine, from the user agent. Which Chromium this is decides what the
// page may use, and it is the first thing anyone asks when a TV renders
// something wrong — so it is stated rather than looked up later.
const engine = () => {
    const agent = navigator.userAgent || '';
    const chromium = /Chrome\/(\d+)/.exec(agent);
    const tizen = /Tizen ([\d.]+)/.exec(agent);

    return [
        chromium ? `chromium ${chromium[1]}` : 'unknown engine',
        tizen ? `tizen ${tizen[1]}` : null
    ].filter(Boolean).join(', ');
};

// The surface actually handed to the app, which is not always the 1920×1080
// the platform promises — and when it is not, everything sized in viewport
// units is wrong. Cheap to print, and it has been the answer before.
//
// Nothing here reaches for `webapis`. Model and firmware would be the best
// device line this log could have, and they need the productinfo privilege
// this app does not carry — so it reports what it can actually see rather
// than calling something that will be refused.
const surface = () => {
    const view = { w: window.innerWidth, h: window.innerHeight };
    const panel = { w: window.screen.width, h: window.screen.height };

    // Two decimals: a television reports exactly 1 and a desktop reports
    // 1.3333333730697632, and nobody needs thirteen digits of that.
    const ratio = Math.round((window.devicePixelRatio || 1) * 100) / 100;

    return {
        text: `viewport ${view.w}x${view.h}, screen ${panel.w}x${panel.h}, dpr ${ratio}`,
        // The webview being handed something other than the panel is the
        // exact shape of a bug this repo has already shipped once: every size
        // on the page is a fraction of the viewport, so a viewport that is not
        // the screen renders the whole interface at the wrong scale.
        mismatched: view.w !== panel.w || view.h !== panel.h
    };
};

// An origin still pointing at the documentation's example host. The build
// warns about this and then happily produces a package with it baked in, so
// it can reach a television — where it presents as YouTube simply loading
// without any of the modifications and no explanation on screen.
const PLACEHOLDER = /(^|\.)example\.(com|net|org|invalid)$/;

const isPlaceholder = (origin) => {
    try {
        return PLACEHOLDER.test(new URL(origin).hostname);
    } catch (e) {
        return false;
    }
};

// ── Starting up ───────────────────────────────────────────────────────

// A cast from a phone arrives as an app-control argument rather than a URL,
// and has to be carried through whichever path is taken.
const castArguments = () => {
    if (!onTv) return '';

    try {
        const data = application.getRequestedAppControl().appControl.data;
        const args = data.filter((entry) => entry.key === 'args')[0];
        return args ? (JSON.parse(args.value[0]).args || '') : '';
    } catch (e) {
        return '';   // a plain launch carries no payload
    }
};

// Returns which keys were claimed and which the model does not have, because
// "8 of 12" is a fact you can act on and "claimed keys" is not.
const claimMediaKeys = () => (onTv ? MEDIA_KEYS : []).reduce((result, key) => {
    try {
        platform.tvinputdevice.registerKey(key);
        result.claimed.push(key);
    } catch (e) {
        result.refused.push(key);
    }
    return result;
}, { claimed: [], refused: [] });

const launchService = () => new Promise((resolve) => {
    if (!onTv) {
        say('service', 'launch skipped, no platform to launch it with', 'warn');
        return resolve();
    }

    const serviceId = `${application.appInfo.packageId}.TubeService`;

    say('service', `launching ${serviceId}`);

    platform.application.launchAppControl(
        new platform.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
        serviceId,
        () => { say('service', 'launch accepted', 'ok'); resolve(); },
        (error) => {
            // Very often it is already running from a previous launch, in
            // which case this "failure" means nothing at all. Either way the
            // next step is the same: ask it.
            say('service', `launch refused: ${error.message}`, 'warn');
            say('service', 'probably already running; asking it anyway');
            resolve();
        }
    );
});

// How long the shell spent on itself before it had to wait for anything, so
// the summary at the end can apportion the blame.
let shellReadyAt = 0;
let serviceUpAt = 0;

const boot = async () => {
    const info = application ? application.appInfo : null;

    // The banner, in the shape of `Linux version ...`: what this is, then
    // what it is running on, before anything is attempted.
    say('tube', `YouTube ${(info && info.version) || 'dev'}`, 'note');
    if (info) say('tube', `package ${info.packageId}, app ${info.id}`);

    say('webview', engine());

    const view = surface();
    say('webview', view.text, view.mismatched ? 'warn' : undefined);
    if (view.mismatched) {
        say('webview', 'viewport is not the panel — everything sized in vw will be off', 'warn');
    }

    say('webview', `locale ${navigator.language || 'unknown'}`);

    // Not a line that earns its place most of the time, and the one time it
    // does it explains every failure below it.
    say('net', navigator.onLine === false ? 'offline' : 'online',
        navigator.onLine === false ? 'bad' : undefined);

    if (onTv) {
        const keys = claimMediaKeys();

        say('tvinputdevice', `${keys.claimed.length}/${MEDIA_KEYS.length} keys registered`,
            keys.refused.length ? 'warn' : 'ok');

        // Named rather than counted. Which key a model lacks decides which
        // button does nothing on the remote, and that is worth one line.
        if (keys.refused.length) {
            say('tvinputdevice', `not on this model: ${keys.refused.join(' ')}`);
        }
    } else {
        say('tvinputdevice', 'no platform, keys not claimed', 'warn');
    }

    const args = castArguments();
    say('appcontrol', args ? `cast payload, ${args.length} bytes` : 'plain launch, no payload');
    if (args) say('appcontrol', args.slice(0, 96), 'note');

    shellReadyAt = now();

    await launchService();

    const started = now();
    const deadline = started + GIVE_UP_AFTER;

    let described = false;
    let announcedWait = false;
    let nextNudge = started + 5000;
    let polls = 0;

    for (;;) {
        let state = null;
        polls += 1;

        try {
            // Never longer than what is left of the deadline, and never so
            // short it cannot complete a request on a slow TV.
            const left = Math.max(deadline - now(), 500);

            state = await ask(`/__tube/state${onTv ? '' : window.location.search}`, Math.min(left, 8000));
        } catch (failure) {
            if (!announcedWait) {
                say('state', `no answer yet (${failure.message}), polling every ${POLL_INTERVAL}ms ` +
                             `for up to ${GIVE_UP_AFTER / 1000}s`);
                announcedWait = true;
            }
        }

        // The kernel says so when a task has been blocked too long, and for
        // the same reason: a log that has gone quiet is indistinguishable
        // from one that has stopped.
        if (!state && now() > nextNudge) {
            say('state', `still waiting, ${((now() - started) / 1000).toFixed(1)}s elapsed`, 'warn');
            nextNudge = now() + 5000;
        }

        if (state) {
            // Said once, not on every poll: a log that repeats itself buries
            // the one line that mattered.
            if (!described) {
                described = true;
                serviceUpAt = now();

                say('state', `up after ${polls} ${polls === 1 ? 'poll' : 'polls'}, ` +
                             `${((serviceUpAt - started) / 1000).toFixed(3)}s`, 'ok');

                if (state.platformVersion) {
                    // Which script a TV gets is derived from its platform
                    // version, and that derivation is the only reason an old
                    // set behaves differently. Stated as the inference it is.
                    say('state', `tizen ${state.platformVersion} takes the ${state.variant} userscript`);
                }
                if (state.ip) say('state', `device ${state.ip}`);

                // The flags, verbatim. This is the whole decision the next
                // few lines are about, so it is worth being able to read it
                // rather than infer it from what happened afterwards.
                say('state', `canInject=${state.canInject ? 1 : 0} ` +
                             `connecting=${state.isConnecting ? 1 : 0} ` +
                             `lastInjectFailed=${state.injectionFailed ? 1 : 0}`);

                if (state.script && state.script.error) {
                    say('loader', `no userscript: ${state.script.error}`, 'bad');
                    say('loader', 'youtube will load unmodified', 'warn');
                } else if (state.script) {
                    say('loader', `userscript ${state.script.variant} ${state.script.version}`, 'ok');
                    say('loader', `origin ${state.script.origin}`);

                    if (isPlaceholder(state.script.origin)) {
                        say('loader', 'that origin is the documentation placeholder', 'bad');
                        say('loader', 'set tube.origin in tizen.config.json and rebuild', 'warn');
                    }

                    if (state.script.variant === 'legacy') {
                        say('loader', 'legacy build: this set is older than the modern script targets', 'note');
                    }
                }
            }

            // A debug attempt that already failed will fail again. Going
            // straight to the proxy is both faster and the only way this
            // does not become a relaunch loop.
            if (state.injectionFailed) {
                say('inject', 'skipped, the last attempt failed', 'warn');
                return useProxy(state, args);
            }

            if (state.canInject && !state.isConnecting) return useDebugger(state, args);

            if (state.canInject && state.isConnecting) {
                // Another launch of this app is mid-injection. It will replace
                // this window when it succeeds, so the only thing to do is
                // wait — but keep waiting, rather than stopping forever as
                // the previous version did.
                if (!announcedWait) {
                    say('inject', 'another launch is already connecting, waiting for it', 'note');
                    announcedWait = true;
                }
            } else if (!state.canInject) {
                say('inject', 'unavailable, developer mode is off', 'warn');
                return useProxy(state, args);
            }
        }

        if (now() > deadline) return giveUp(state, args);

        await wait(POLL_INTERVAL);
    }
};

// Injection relaunches this app under the debugger, so this window is about
// to be replaced. Exiting is what makes room for it — and if the relaunch
// does not happen, the service brings the app back on the proxy path.
const useDebugger = async (state, args) => {
    say('inject', 'available, developer mode is on', 'ok');
    say('inject', `asking the service to attach on ${state.ip || 'loopback'}`);

    try {
        await ask(`/__tube/inject${args ? `?${args}` : ''}`);
        say('inject', 'accepted, relaunching under the debugger');
    } catch (e) {
        // The request not returning cleanly does not mean it did not land.
        say('inject', 'no reply, which usually means it landed anyway');
    }

    summarise();

    if (!onTv) return hold('inject', 'would exit now and let the debugger take over');

    say('tube', 'handing over to the debugger; this window is about to be replaced');
    handOver();
    application.exit();
};

const useProxy = (state, args) => {
    const target = state.proxyUrl + (args ? `&${args}` : '');

    say('proxy', 'routing youtube.com through the local proxy');
    say('proxy', target);

    summarise();

    if (!canHandOver(state)) return hold('proxy', 'would navigate there now');

    say('tube', 'handing over to youtube');

    // One frame to paint the last line before the page is replaced.
    setTimeout(() => {
        handOver();
        window.location.href = target;
    }, 120);
};

// Everything has failed to answer. The proxy URL is a constant, so it is
// still worth trying blind — the service may simply be slow rather than dead,
// and a page that loads late beats an app that never opens.
const giveUp = (state, args) => {
    say('state', `gave up after ${GIVE_UP_AFTER / 1000}s`, 'bad');
    say('state', 'the service never came up, or came up without opening its port', 'bad');

    if (state && state.proxyUrl) return useProxy(state, args);

    // The proxy URL is a constant even when nothing answered, so this is
    // still worth trying: the service may be slow rather than dead, and a
    // page that loads late beats an app that never opens.
    say('proxy', 'no state was ever read; trying the proxy blind', 'warn');

    summarise();

    if (!onTv) return hold('proxy', `would navigate to ${BASE}/tv`);

    setTimeout(() => {
        handOver();
        window.location.href = `${BASE}/tv${args ? `?${args}` : ''}`;
    }, 400);
};

// Leaving with the remote's Return key, at any point during startup.
document.addEventListener('keydown', (event) => {
    if (onTv && (event.keyCode === 10009 || event.keyCode === 27)) application.exit();
});

boot();
