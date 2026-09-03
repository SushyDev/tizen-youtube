import './boot.css';

const PORT = 8099;

// No `tizen` object off a television, which decides whether this file may exit.
const platform = typeof tizen === 'undefined' ? null : tizen;
const application = platform ? platform.application.getCurrentApplication() : null;
const onTv = !!application;

const BASE = onTv ? `http://localhost:${PORT}` : '';

const GIVE_UP_AFTER = 20000;
const POLL_INTERVAL = 200;

// Media keys must be claimed before the player exists.
const MEDIA_KEYS = [
    'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
    'MediaFastForward', 'MediaRewind', 'MediaTrackNext', 'MediaTrackPrevious',
    'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue'
];

const startedAt = (window.performance && window.performance.now)
    ? window.performance.now()
    : Date.now();

const now = () => ((window.performance && window.performance.now)
    ? window.performance.now()
    : Date.now()) - startedAt;

const logElement = document.getElementById('log');

let handedOver = false;

// Oldest lines fall off the top; TV webviews handle scrollTop inconsistently.
const MAX_LINES = 34;

const say = (facility, message, tone) => {
    if (handedOver) return;

    const line = document.createElement('div');

    const stamp = document.createElement('span');
    stamp.className = 't';
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

const handOver = () => {
    handedOver = true;
    document.body.className = 'done';
};

const canHandOver = (state) => onTv || !!(state && state.handOver);

const hold = (facility, what) => {
    say(facility, what, 'note');
    say('tube', 'held — off-TV, so nothing is handed over', 'note');
    document.body.className = 'held';
};

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

// A budget, not a constant, so the last poll cannot outlive the announced deadline.
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

const engine = () => {
    const agent = navigator.userAgent || '';
    const chromium = /Chrome\/(\d+)/.exec(agent);
    const tizen = /Tizen ([\d.]+)/.exec(agent);

    return [
        chromium ? `chromium ${chromium[1]}` : 'unknown engine',
        tizen ? `tizen ${tizen[1]}` : null
    ].filter(Boolean).join(', ');
};

// Not always the 1920x1080 the platform promises, and model and firmware would need a
// privilege this app lacks.
const surface = () => {
    const view = { w: window.innerWidth, h: window.innerHeight };
    const panel = { w: window.screen.width, h: window.screen.height };

    // A television reports exactly 1, a desktop 1.3333333730697632.
    const ratio = Math.round((window.devicePixelRatio || 1) * 100) / 100;

    return {
        text: `viewport ${view.w}x${view.h}, screen ${panel.w}x${panel.h}, dpr ${ratio}`,
        // A viewport that is not the panel renders every vw-sized element wrong.
        mismatched: view.w !== panel.w || view.h !== panel.h
    };
};

// An origin still pointing at the example host presents as YouTube loading with none of
// the modifications and no explanation on screen.
const PLACEHOLDER = /(^|\.)example\.(com|net|org|invalid)$/;

const isPlaceholder = (origin) => {
    try {
        return PLACEHOLDER.test(new URL(origin).hostname);
    } catch (e) {
        return false;
    }
};

// A cast from a phone arrives as an app-control argument rather than a URL.
const castArguments = () => {
    if (!onTv) return '';

    try {
        const data = application.getRequestedAppControl().appControl.data;
        const args = data.filter((entry) => entry.key === 'args')[0];
        return args ? (JSON.parse(args.value[0]).args || '') : '';
    } catch (e) {
        return '';
    }
};

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
            say('service', `launch refused: ${error.message}`, 'warn');
            say('service', 'probably already running; asking it anyway');
            resolve();
        }
    );
});

let shellReadyAt = 0;
let serviceUpAt = 0;

const boot = async () => {
    const info = application ? application.appInfo : null;

    say('tube', `YouTube ${(info && info.version) || 'dev'}`, 'note');
    if (info) say('tube', `package ${info.packageId}, app ${info.id}`);

    say('webview', engine());

    const view = surface();
    say('webview', view.text, view.mismatched ? 'warn' : undefined);
    if (view.mismatched) {
        say('webview', 'viewport is not the panel — everything sized in vw will be off', 'warn');
    }

    say('webview', `locale ${navigator.language || 'unknown'}`);

    say('net', navigator.onLine === false ? 'offline' : 'online',
        navigator.onLine === false ? 'bad' : undefined);

    if (onTv) {
        const keys = claimMediaKeys();

        say('tvinputdevice', `${keys.claimed.length}/${MEDIA_KEYS.length} keys registered`,
            keys.refused.length ? 'warn' : 'ok');

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
            // Never longer than what is left of the deadline.
            const left = Math.max(deadline - now(), 500);

            state = await ask(`/__tube/state${onTv ? '' : window.location.search}`, Math.min(left, 8000));
        } catch (failure) {
            if (!announcedWait) {
                say('state', `no answer yet (${failure.message}), polling every ${POLL_INTERVAL}ms ` +
                             `for up to ${GIVE_UP_AFTER / 1000}s`);
                announcedWait = true;
            }
        }

        // A log that has gone quiet is indistinguishable from one that has stopped.
        if (!state && now() > nextNudge) {
            say('state', `still waiting, ${((now() - started) / 1000).toFixed(1)}s elapsed`, 'warn');
            nextNudge = now() + 5000;
        }

        if (state) {
            if (!described) {
                described = true;
                serviceUpAt = now();

                say('state', `up after ${polls} ${polls === 1 ? 'poll' : 'polls'}, ` +
                             `${((serviceUpAt - started) / 1000).toFixed(3)}s`, 'ok');

                if (state.platformVersion) {
                    say('state', `tizen ${state.platformVersion} takes the ${state.variant} userscript`);
                }
                if (state.ip) say('state', `device ${state.ip}`);

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
                }
            }

            return useProxy(state, args);
        }

        if (now() > deadline) return giveUp(state, args);

        await wait(POLL_INTERVAL);
    }
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

// Nothing answered, but the proxy URL is a constant: a page that loads late beats an app
// that never opens.
const giveUp = (state, args) => {
    say('state', `gave up after ${GIVE_UP_AFTER / 1000}s`, 'bad');
    say('state', 'the service never came up, or came up without opening its port', 'bad');

    if (state && state.proxyUrl) return useProxy(state, args);

    say('proxy', 'no state was ever read; trying the proxy blind', 'warn');

    summarise();

    if (!onTv) return hold('proxy', `would navigate to ${BASE}/tv`);

    setTimeout(() => {
        handOver();
        window.location.href = `${BASE}/tv${args ? `?${args}` : ''}`;
    }, 400);
};

document.addEventListener('keydown', (event) => {
    if (onTv && (event.keyCode === 10009 || event.keyCode === 27)) application.exit();
});

boot();
