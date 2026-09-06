import './boot.css';

// Must match service/lib/ports.js, which this cannot require.
const PORT = 8099;

// Must match the port names in service/index.js.
const READY_PORT = 'TUBE_BOOT';
const READY_PORT_OPEN = 'TUBE_BOOT_OPEN';

const GIVE_UP_AFTER = 20000;
const BACKSTOP = 2500;
const NUDGE_EVERY = 5000;
const ASK_TIMEOUT = 8000;
const QUIT_TIMEOUT = 1200;
const MAX_LINES = 34;

const MEDIA_KEYS = [
    'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
    'MediaFastForward', 'MediaRewind', 'MediaTrackNext', 'MediaTrackPrevious',
    'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue'
];

const platform = typeof tizen === 'undefined' ? null : tizen;
const application = platform ? platform.application.getCurrentApplication() : null;
const onTv = !!application;

const BASE = onTv ? `http://localhost:${PORT}` : '';

// -- the log on screen ---------------------------------------------------------------------------

const clock = () => ((window.performance && window.performance.now) ? window.performance.now() : Date.now());

const startedAt = clock();
const now = () => clock() - startedAt;

const logElement = document.getElementById('log');

const shown = { handedOver: false };

const say = (facility, message, tone) => {
    if (shown.handedOver) return;

    const line = document.createElement('div');

    const part = (className, text) => {
        const node = document.createElement('span');
        if (className) node.className = className;
        node.textContent = text;
        line.appendChild(node);
    };

    part('t', `[${(now() / 1000).toFixed(6).padStart(12, ' ')}] `);
    part('s', `${facility}: `);
    part(tone, message);

    logElement.appendChild(line);

    Array.from(logElement.childNodes)
        .slice(0, Math.max(0, logElement.childNodes.length - MAX_LINES))
        .forEach((line) => logElement.removeChild(line));
};

const handOver = () => {
    shown.handedOver = true;
    document.body.className = 'done';
};

const hold = (facility, what) => {
    say(facility, what, 'note');
    say('tube', 'held — off-TV, so nothing is handed over', 'note');
    document.body.className = 'held';
};

const canHandOver = (state) => onTv || !!(state && state.handOver);

window.onerror = (message, _source, line) => say('tube', `page error: ${message} (line ${line})`, 'bad');

// -- talking to the service ----------------------------------------------------------------------

const report = (line) => {
    if (!onTv) return;

    try {
        const request = new XMLHttpRequest();
        request.open('GET', `${BASE}/__tube/booted?t=${encodeURIComponent(line)}`, true);
        request.send();
    } catch (e) { /* the service is not up; the screen already says so */ }
};

const ask = (path, timeout) => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open('GET', BASE + path, true);
    request.timeout = timeout || ASK_TIMEOUT;

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

// -- what this set is ----------------------------------------------------------------------------

const engine = () => {
    const agent = navigator.userAgent || '';
    const chromium = /Chrome\/(\d+)/.exec(agent);
    const version = /Tizen ([\d.]+)/.exec(agent);

    return [
        chromium ? `chromium ${chromium[1]}` : 'unknown engine',
        version ? `tizen ${version[1]}` : null
    ].filter(Boolean).join(', ');
};

const surface = () => {
    const view = { w: window.innerWidth, h: window.innerHeight };
    const panel = { w: window.screen.width, h: window.screen.height };
    const ratio = Math.round((window.devicePixelRatio || 1) * 100) / 100;

    return {
        text: `viewport ${view.w}x${view.h}, screen ${panel.w}x${panel.h}, dpr ${ratio}`,
        mismatched: view.w !== panel.w || view.h !== panel.h
    };
};

const PLACEHOLDER = /(^|\.)example\.(com|net|org|invalid)$/;

const isPlaceholder = (origin) => {
    try {
        return PLACEHOLDER.test(new URL(origin).hostname);
    } catch (e) {
        return false;
    }
};

const localProxyUrl = () => `${BASE}/tv`;

const withArgs = (url, args) => (args ? `${url}${url.indexOf('?') === -1 ? '?' : '&'}${args}` : url);

const paintThen = (act) => {
    const once = { done: false };

    const go = () => {
        if (once.done) return;
        once.done = true;
        act();
    };

    setTimeout(go, 250);
    if (window.requestAnimationFrame) requestAnimationFrame(() => requestAnimationFrame(go));
};

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

// -- starting the service ------------------------------------------------------------------------

const launchService = () => new Promise((resolve) => {
    if (!onTv) {
        say('service', 'launch skipped, no platform to launch it with', 'warn');
        return resolve();
    }

    const serviceId = `${application.appInfo.packageId}.TubeService`;
    say('service', `launching ${serviceId}`);

    return platform.application.launchAppControl(
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

// Everything the summary needs, gathered rather than scattered across the module.
const timings = {
    shellReady: 0,
    serviceUp: 0,
    keysTook: 0,
    asks: 0,
    firstAsk: 0,
    foundBy: 'ask',
    portState: 'not tried',
    toldAt: 0,
    toldBy: ''
};

const awaitAnnouncement = () => {
    if (!onTv) return null;

    if (!platform.messageport) {
        timings.portState = 'no tizen.messageport in the shell';
        say('state', 'this webview has no message port; asking instead', 'warn');
        return null;
    }

    const registered = [];

    const promise = new Promise((resolve) => {
        const listen = (label, open) => {
            try {
                open().addMessagePortListener((data) => {
                    timings.toldAt = now();
                    timings.toldBy = label;

                    const carried = (data || []).filter((item) => item.key === 'state')[0];

                    try {
                        resolve(carried ? JSON.parse(carried.value) : null);
                    } catch (e) {
                        resolve(null);
                    }
                });

                registered.push(label);
            } catch (e) {
                registered.push(`${label} refused ${e.name || e.message}`);
            }
        };

        listen('trusted', () => platform.messageport.requestTrustedLocalMessagePort(READY_PORT));
        listen('open', () => platform.messageport.requestLocalMessagePort(READY_PORT_OPEN));
    });

    timings.portState = registered.join('+');
    return promise;
};

const reachService = async () => {
    const started = now();
    const deadline = started + GIVE_UP_AFTER;
    const announced = awaitAnnouncement();

    const tries = { asks: 0, launched: false, saidWaiting: false, nextNudge: started + NUDGE_EVERY };

    const askOnce = async () => {
        tries.asks += 1;
        if (tries.asks === 1) timings.firstAsk = now();

        const left = Math.max(deadline - now(), 500);

        return ask(`/__tube/state${onTv ? '' : window.location.search}`, Math.min(left, ASK_TIMEOUT));
    };

    const explainTheWait = (failure) => {
        if (!tries.launched) {
            tries.launched = true;
            launchService();
        }

        if (tries.saidWaiting) return;

        tries.saidWaiting = true;
        say('state', announced
            ? `no answer yet (${failure.message}); waiting to be told it is up`
            : `no answer yet (${failure.message}), asking again for up to ${GIVE_UP_AFTER / 1000}s`);
    };

    const nudgeIfItHasBeenAWhile = () => {
        if (now() <= tries.nextNudge) return;

        say('state', `still waiting, ${((now() - started) / 1000).toFixed(1)}s elapsed`, 'warn');
        tries.nextNudge = now() + NUDGE_EVERY;
    };

    // Recursion rather than a loop: each attempt is one pass, and the tail is the next attempt.
    const attempt = async () => {
        const state = await askOnce().catch((failure) => {
            explainTheWait(failure);
            return null;
        });

        if (state) {
            timings.serviceUp = now();
            return { state, asks: tries.asks, by: 'ask' };
        }

        nudgeIfItHasBeenAWhile();

        if (now() > deadline) return { state: null, asks: tries.asks, by: 'gave up' };

        const backstop = wait(Math.max(Math.min(BACKSTOP, deadline - now()), 0)).then(() => null);
        const told = announced ? await Promise.race([announced, backstop]) : await backstop;

        if (!told) return attempt();

        timings.serviceUp = now();
        return { state: told, asks: tries.asks, by: 'announcement' };
    };

    return attempt();
};

// -- what happened -------------------------------------------------------------------------------

const summarise = () => {
    const total = now();
    const seconds = (ms) => (ms / 1000).toFixed(3);

    const line = [
        `shell ${seconds(timings.shellReady)}s`,
        `keys ${seconds(timings.keysTook)}s`,
        `asked at ${seconds(timings.firstAsk)}s`,
        timings.serviceUp ? `service ${seconds(timings.serviceUp)}s` : 'service never answered',
        `${timings.asks} ${timings.asks === 1 ? 'ask' : 'asks'}`,
        `by ${timings.foundBy}`,
        `port ${timings.portState}`,
        timings.toldAt ? `told by ${timings.toldBy} at ${seconds(timings.toldAt)}s` : 'never told',
        `total ${seconds(total)}s`
    ].join(', ');

    say('tube', `startup finished in ${seconds(total)}s (${line})`, timings.serviceUp ? 'ok' : 'warn');

    report(line);
};

const describe = (state, asks) => {
    say('state', `up after ${asks} ${asks === 1 ? 'ask' : 'asks'}, `
        + `${(timings.serviceUp / 1000).toFixed(3)}s`, 'ok');

    if (state.platformVersion) say('state', `tizen ${state.platformVersion}`);

    if (state.script && state.script.error) {
        say('loader', `no userscript: ${state.script.error}`, 'bad');
        say('loader', 'youtube will load unmodified', 'warn');
        return;
    }

    if (!state.script) return;

    say('loader', `userscript ${state.script.version}`, 'ok');
    say('loader', `origin ${state.script.origin}`);

    if (isPlaceholder(state.script.origin)) {
        say('loader', 'that origin is the documentation placeholder', 'bad');
        say('loader', 'set tube.origin in tizen.config.json and rebuild', 'warn');
    }
};

// -- handing over --------------------------------------------------------------------------------

// This screen only ever runs in a build without the container metadata: a package carrying
// nativeID never runs its own content, and the platform launches Cobalt in its place.
const useProxy = (state, args) => {
    const target = withArgs((state && state.proxyUrl) || localProxyUrl(), args);

    say('proxy', 'routing youtube.com through the local proxy');
    say('proxy', target);

    summarise();

    if (!canHandOver(state)) return hold('proxy', 'would navigate there now');

    say('tube', 'handing over to youtube');

    return paintThen(() => {
        handOver();
        window.location.href = target;
    });
};

// Nothing is served without the service: the proxy is the service, so navigating there only
// replaces this log with its error page and takes the reason with it.
const giveUp = () => {
    say('state', `gave up after ${GIVE_UP_AFTER / 1000}s`, 'bad');
    say('state', 'the service never came up, or came up without opening its port', 'bad');

    summarise();

    say('proxy', 'not navigating — the proxy is the service, and it never came up', 'warn');
    say('tube', 'held on this screen; press Back to close', 'note');

    document.body.className = 'held';
    return undefined;
};

const stopEverything = () => {
    const left = { yes: false };

    const leave = () => {
        if (left.yes) return;
        left.yes = true;
        application.exit();
    };

    say('tube', 'stopping the service and closing', 'note');

    try {
        const request = new XMLHttpRequest();
        request.open('GET', `${BASE}/__tube/quit`, true);
        request.timeout = QUIT_TIMEOUT;
        request.onloadend = leave;
        request.send();
    } catch (e) {
        return leave();
    }

    setTimeout(leave, QUIT_TIMEOUT);
    return undefined;
};

// -- boot ------------------------------------------------------------------------------------------

const boot = async () => {
    const reaching = reachService();
    const args = castArguments();
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
        const beforeKeys = now();
        const keys = claimMediaKeys();
        timings.keysTook = now() - beforeKeys;

        say('tvinputdevice',
            `${keys.claimed.length}/${MEDIA_KEYS.length} keys registered in ${timings.keysTook.toFixed(1)}ms`,
            keys.refused.length ? 'warn' : 'ok');

        if (keys.refused.length) say('tvinputdevice', `not on this model: ${keys.refused.join(' ')}`);
    } else {
        say('tvinputdevice', 'no platform, keys not claimed', 'warn');
    }

    say('appcontrol', args ? `cast payload, ${args.length} bytes` : 'plain launch, no payload');
    if (args) say('appcontrol', args.slice(0, 96), 'note');

    timings.shellReady = now();

    const reached = await reaching;
    timings.asks = reached.asks;
    timings.foundBy = reached.by;

    if (!reached.state) return giveUp();

    describe(reached.state, reached.asks);

    return useProxy(reached.state, args);
};

document.addEventListener('keydown', (event) => {
    if (onTv && (event.keyCode === 10009 || event.keyCode === 27)) stopEverything();
});

boot();
