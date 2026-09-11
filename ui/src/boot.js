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

const clock = () => ((window.performance && window.performance.now) ? window.performance.now() : Date.now());

const startedAt = clock();
const now = () => clock() - startedAt;

const logElement = document.getElementById('log');

const startup = {
    handedOver: false,
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

const say = (facility, message, tone) => {
    if (startup.handedOver) return;

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
        .forEach((stale) => logElement.removeChild(stale));
};

const handOver = () => {
    startup.handedOver = true;
    document.body.className = 'done';
};

const hold = (facility, what) => {
    say(facility, what, 'note');
    say('tube', 'held — off-TV, so nothing is handed over', 'note');
    document.body.className = 'held';
};

const canHandOver = (state) => onTv || !!(state && state.handOver);

window.onerror = (message, _source, line) => say('tube', `page error: ${message} (line ${line})`, 'bad');

const report = (line) => {
    if (!onTv) return;

    try {
        const request = new XMLHttpRequest();
        request.open('GET', `${BASE}/__tube/booted?t=${encodeURIComponent(line)}`, true);
        request.send();
    } catch (e) { }
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

const runOnce = (act) => {
    const record = { ran: false };

    return () => {
        if (record.ran) return;
        record.ran = true;
        act();
    };
};

const paintThen = (act) => {
    const go = runOnce(act);

    setTimeout(go, 250);
    if (window.requestAnimationFrame) requestAnimationFrame(() => requestAnimationFrame(go));
};

const claimMediaKeys = () => {
    const tried = (onTv ? MEDIA_KEYS : []).map((key) => {
        try {
            platform.tvinputdevice.registerKey(key);
            return { key, ok: true };
        } catch (e) {
            return { key, ok: false };
        }
    });

    return {
        claimed: tried.filter((one) => one.ok).map((one) => one.key),
        refused: tried.filter((one) => !one.ok).map((one) => one.key)
    };
};

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
        startup.portState = 'no tizen.messageport in the shell';
        say('state', 'this webview has no message port; asking instead', 'warn');
        return null;
    }

    return new Promise((resolve) => {
        const listen = (label, open) => {
            try {
                open().addMessagePortListener((data) => {
                    startup.toldAt = now();
                    startup.toldBy = label;

                    const carried = (data || []).filter((item) => item.key === 'state')[0];

                    try {
                        resolve(carried ? JSON.parse(carried.value) : null);
                    } catch (e) {
                        resolve(null);
                    }
                });

                return label;
            } catch (e) {
                return `${label} refused ${e.name || e.message}`;
            }
        };

        startup.portState = [
            listen('trusted', () => platform.messageport.requestTrustedLocalMessagePort(READY_PORT)),
            listen('open', () => platform.messageport.requestLocalMessagePort(READY_PORT_OPEN))
        ].join('+');
    });
};

const reachService = async () => {
    const started = now();
    const deadline = started + GIVE_UP_AFTER;
    const announced = awaitAnnouncement();

    const tries = { launched: false, saidWaiting: false, nextNudge: started + NUDGE_EVERY };

    const askOnce = async () => {
        startup.asks += 1;
        if (startup.asks === 1) startup.firstAsk = now();

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

    const attempt = async () => {
        const state = await askOnce().catch((failure) => {
            explainTheWait(failure);
            return null;
        });

        if (state) {
            startup.serviceUp = now();
            return { state, by: 'ask' };
        }

        nudgeIfItHasBeenAWhile();

        if (now() > deadline) return { state: null, by: 'gave up' };

        const backstop = wait(Math.max(Math.min(BACKSTOP, deadline - now()), 0)).then(() => null);
        const told = announced ? await Promise.race([announced, backstop]) : await backstop;

        if (!told) return attempt();

        startup.serviceUp = now();
        return { state: told, by: 'announcement' };
    };

    return attempt();
};

const summarise = () => {
    const total = now();
    const seconds = (ms) => (ms / 1000).toFixed(3);

    const line = [
        `shell ${seconds(startup.shellReady)}s`,
        `keys ${seconds(startup.keysTook)}s`,
        `asked at ${seconds(startup.firstAsk)}s`,
        startup.serviceUp ? `service ${seconds(startup.serviceUp)}s` : 'service never answered',
        `${startup.asks} ${startup.asks === 1 ? 'ask' : 'asks'}`,
        `by ${startup.foundBy}`,
        `port ${startup.portState}`,
        startup.toldAt ? `told by ${startup.toldBy} at ${seconds(startup.toldAt)}s` : 'never told',
        `total ${seconds(total)}s`
    ].join(', ');

    say('tube', `startup finished in ${seconds(total)}s (${line})`, startup.serviceUp ? 'ok' : 'warn');

    report(line);
};

const describe = (state) => {
    say('state', `up after ${startup.asks} ${startup.asks === 1 ? 'ask' : 'asks'}, `
        + `${(startup.serviceUp / 1000).toFixed(3)}s`, 'ok');

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

// This screen only ever runs in a build without the container metadata: a package carrying
// nativeID never runs its own content, and the platform launches Cobalt in its place.
const useProxy = (state) => {
    const target = (state && state.proxyUrl) || localProxyUrl();

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
    const leave = runOnce(() => application.exit());

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

const boot = async () => {
    const reaching = reachService();
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
        startup.keysTook = now() - beforeKeys;

        say('tvinputdevice',
            `${keys.claimed.length}/${MEDIA_KEYS.length} keys registered in ${startup.keysTook.toFixed(1)}ms`,
            keys.refused.length ? 'warn' : 'ok');

        if (keys.refused.length) say('tvinputdevice', `not on this model: ${keys.refused.join(' ')}`);
    } else {
        say('tvinputdevice', 'no platform, keys not claimed', 'warn');
    }

    startup.shellReady = now();

    const reached = await reaching;
    startup.foundBy = reached.by;

    if (!reached.state) return giveUp();

    describe(reached.state);

    return useProxy(reached.state);
};

document.addEventListener('keydown', (event) => {
    if (onTv && (event.keyCode === 10009 || event.keyCode === 27)) stopEverything();
});

boot();
