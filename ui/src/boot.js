import './boot.css';

// Must match service/lib/ports.js, which this cannot require.
const PORT = 8099;
const DIAL_PORT = 8095;

const platform = typeof tizen === 'undefined' ? null : tizen;
const application = platform ? platform.application.getCurrentApplication() : null;
const onTv = !!application;

const BASE = onTv ? `http://localhost:${PORT}` : '';

const GIVE_UP_AFTER = 20000;

const READY_PORT = 'TUBE_BOOT';
const READY_PORT_OPEN = 'TUBE_BOOT_OPEN';

const BACKSTOP = 2500;

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

const report = (line) => {
    if (!onTv) return;

    try {
        const request = new XMLHttpRequest();
        request.open('GET', `${BASE}/__tube/booted?t=${encodeURIComponent(line)}`, true);
        request.send();
    } catch (e) {
    }
};

const summarise = () => {
    const total = now();

    const line = [
        `shell ${(shellReadyAt / 1000).toFixed(3)}s`,
        `keys ${(keysTookMs / 1000).toFixed(3)}s`,
        `asked at ${(firstAskAt / 1000).toFixed(3)}s`,
        serviceUpAt ? `service ${(serviceUpAt / 1000).toFixed(3)}s` : 'service never answered',
        `${serviceAsks} ${serviceAsks === 1 ? 'ask' : 'asks'}`,
        `by ${foundBy}`,
        `port ${portState}`,
        toldAt ? `told by ${toldBy} at ${(toldAt / 1000).toFixed(3)}s` : 'never told',
        `total ${(total / 1000).toFixed(3)}s`
    ].join(', ');

    say('tube', `startup finished in ${(total / 1000).toFixed(3)}s (${line})`,
        serviceUpAt ? 'ok' : 'warn');

    report(line);
};

window.onerror = (message, _source, line) => say('tube', `page error: ${message} (line ${line})`, 'bad');

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

const localProxyUrl = () => `${BASE}/tv` + (onTv
    ? `?additionalDataUrl=${encodeURIComponent(`http://localhost:${DIAL_PORT}/dial/apps/YouTube`)}`
    : '');

const withArgs = (url, args) => (args ? `${url}${url.indexOf('?') === -1 ? '?' : '&'}${args}` : url);

const paintThen = (act) => {
    let acted = false;

    const once = () => {
        if (acted) return;
        acted = true;
        act();
    };

    setTimeout(once, 250);
    if (window.requestAnimationFrame) requestAnimationFrame(() => requestAnimationFrame(once));
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

const awaitAnnouncement = () => {
    if (!onTv) return null;

    if (!platform.messageport) {
        portState = 'no tizen.messageport in the shell';
        say('state', 'this webview has no message port; asking instead', 'warn');
        return null;
    }

    const registered = [];

    const promise = new Promise((resolve) => {
        const listen = (label, open) => {
            try {
                open().addMessagePortListener((data) => {
                    toldAt = now();
                    toldBy = label;

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

    portState = registered.join('+');
    return promise;
};

let shellReadyAt = 0;
let serviceUpAt = 0;
let keysTookMs = 0;
let serviceAsks = 0;
let firstAskAt = 0;
let foundBy = 'ask';
let portState = 'not tried';
let toldAt = 0;
let toldBy = '';

const reachService = async () => {
    const started = now();
    const deadline = started + GIVE_UP_AFTER;

    const announced = awaitAnnouncement();

    let asks = 0;
    let launched = false;
    let announcedWait = false;
    let nextNudge = started + 5000;

    for (;;) {
        asks += 1;
        if (asks === 1) firstAskAt = now();

        try {
            const left = Math.max(deadline - now(), 500);
            const state = await ask(`/__tube/state${onTv ? '' : window.location.search}`, Math.min(left, 8000));

            serviceUpAt = now();
            return { state, asks, by: 'ask' };
        } catch (failure) {
            if (!launched) {
                launched = true;
                launchService();
            }

            if (!announcedWait) {
                announcedWait = true;
                say('state', announced
                    ? `no answer yet (${failure.message}); waiting to be told it is up`
                    : `no answer yet (${failure.message}), asking again for up to ${GIVE_UP_AFTER / 1000}s`);
            }
        }

        if (now() > nextNudge) {
            say('state', `still waiting, ${((now() - started) / 1000).toFixed(1)}s elapsed`, 'warn');
            nextNudge = now() + 5000;
        }

        if (now() > deadline) return { state: null, asks, by: 'gave up' };

        const backstop = wait(Math.max(Math.min(BACKSTOP, deadline - now()), 0)).then(() => null);

        const told = announced ? await Promise.race([announced, backstop]) : await backstop;

        if (told) {
            serviceUpAt = now();
            return { state: told, asks, by: 'announcement' };
        }
    }
};

const describe = (state, asks) => {
    say('state', `up after ${asks} ${asks === 1 ? 'ask' : 'asks'}, ` +
                 `${(serviceUpAt / 1000).toFixed(3)}s`, 'ok');

    if (state.platformVersion) {
        say('state', `tizen ${state.platformVersion} takes the ${state.variant} userscript`);
    }

    if (state.script && state.script.error) {
        say('loader', `no userscript: ${state.script.error}`, 'bad');
        say('loader', 'youtube will load unmodified', 'warn');
        return;
    }

    if (state.script) {
        say('loader', `userscript ${state.script.variant} ${state.script.version}`, 'ok');
        say('loader', `origin ${state.script.origin}`);

        if (isPlaceholder(state.script.origin)) {
            say('loader', 'that origin is the documentation placeholder', 'bad');
            say('loader', 'set tube.origin in tizen.config.json and rebuild', 'warn');
        }
    }
};

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
        keysTookMs = now() - beforeKeys;

        say('tvinputdevice', `${keys.claimed.length}/${MEDIA_KEYS.length} keys registered in ` +
            `${keysTookMs.toFixed(1)}ms`,
            keys.refused.length ? 'warn' : 'ok');

        if (keys.refused.length) {
            say('tvinputdevice', `not on this model: ${keys.refused.join(' ')}`);
        }
    } else {
        say('tvinputdevice', 'no platform, keys not claimed', 'warn');
    }

    say('appcontrol', args ? `cast payload, ${args.length} bytes` : 'plain launch, no payload');
    if (args) say('appcontrol', args.slice(0, 96), 'note');

    shellReadyAt = now();

    const reached = await reaching;
    serviceAsks = reached.asks;
    foundBy = reached.by;

    if (!reached.state) return giveUp();

    describe(reached.state, reached.asks);

    return useProxy(reached.state, args);
};

const useProxy = (state, args) => {
    const target = withArgs((state && state.proxyUrl) || localProxyUrl(), args);

    say('proxy', 'routing youtube.com through the local proxy');
    say('proxy', target);

    summarise();

    if (!canHandOver(state)) return hold('proxy', 'would navigate there now');

    say('tube', 'handing over to youtube');

    const go = () => {
        handOver();
        window.location.href = target;
    };

    return paintThen(go);
};

const giveUp = () => {
    say('state', `gave up after ${GIVE_UP_AFTER / 1000}s`, 'bad');
    say('state', 'the service never came up, or came up without opening its port', 'bad');

    summarise();

    // Nothing is served without the service: the proxy is the service, so navigating there
    // only replaces this log with its error page and takes the reason with it.
    say('proxy', 'not navigating — the proxy is the service, and it never came up', 'warn');
    say('tube', 'held on this screen; press Back to close', 'note');

    document.body.className = 'held';
    return undefined;
};

const stopEverything = () => {
    let left = false;

    const leave = () => {
        if (left) return;
        left = true;
        application.exit();
    };

    say('tube', 'stopping the service and closing', 'note');

    try {
        const request = new XMLHttpRequest();
        request.open('GET', `${BASE}/__tube/quit`, true);
        request.timeout = 1200;
        request.onloadend = leave;
        request.send();
    } catch (e) {
        return leave();
    }

    setTimeout(leave, 1200);
    return undefined;
};

document.addEventListener('keydown', (event) => {
    if (onTv && (event.keyCode === 10009 || event.keyCode === 27)) stopEverything();
});

boot();
