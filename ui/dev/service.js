// A television, for styling the boot log against. With no TV to talk to this answers
// instead, and `boot.js` holds on the last line rather than handing over. Each
// scenario is a real path through `boot.js`, selected by the query string:
//
//   /                    developer mode off, the proxy path
//   /?boot=debugger      developer mode on, injection
//   /?boot=failed        injection already failed once
//   /?boot=slow          the service never answers, and it gives up
//   /?boot=script        the userscript could not be resolved

const PROXY_URL = 'http://localhost:8098/tv?additionalDataUrl=' +
    encodeURIComponent('http://localhost:8097/dial/apps/YouTube');

const BASE = {
    ip: '192.168.2.9',
    platformVersion: '6.5',
    variant: 'modern',
    proxyUrl: PROXY_URL,
    script: { version: '2.0.1', origin: 'https://cdn.example.com/tube', variant: 'modern' }
};

const SCENARIOS = {
    // Developer mode off: the ordinary path for a TV nobody has unlocked.
    proxy: { ...BASE, canInject: false, isConnecting: false, injectionFailed: false },

    // Developer mode on: the shell hands over to the debugger and exits.
    debugger: { ...BASE, canInject: true, isConnecting: false, injectionFailed: false },

    // Tried last launch and did not take, so this one goes straight to the proxy.
    failed: { ...BASE, canInject: true, isConnecting: false, injectionFailed: true },

    // Another launch of the app is already mid-injection.
    connecting: { ...BASE, canInject: true, isConnecting: true, injectionFailed: false },

    // The one state that logs in the error tone without anything else being wrong.
    script: {
        ...BASE,
        canInject: false,
        isConnecting: false,
        injectionFailed: false,
        script: { error: 'no cached bundle and the origin is unreachable' }
    }

    // `slow` is deliberately absent: it is the absence of an answer, handled below.
};

/** Stands in for the on-TV service. `enabled` is false when there is a real device. */
const devService = ({ enabled }) => ({
    name: 'tube-dev-service',
    apply: 'serve',

    configureServer(server) {
        if (!enabled) return;

        const say = (message) => server.config.logger.info(`  [36mtv[0m  ${message}`);

        server.middlewares.use((request, response, next) => {
            const [path, query] = request.url.split('?');
            if (path.indexOf('/__tube/') !== 0) return next();

            const wanted = new URLSearchParams(query || '').get('boot') || 'proxy';

            // Never answering is itself a scenario: the only way to see boot.js give up.
            if (wanted === 'slow') {
                say('holding /__tube/state open so the shell gives up');
                return;
            }

            const state = SCENARIOS[wanted] || SCENARIOS.proxy;

            response.setHeader('content-type', 'application/json; charset=utf-8');
            response.setHeader('access-control-allow-origin', '*');

            if (path === '/__tube/inject') {
                say(`inject requested (${wanted})`);
                return response.end(JSON.stringify({ ok: true }));
            }

            response.end(JSON.stringify(state));
        });

        server.httpServer.once('listening', () => {
            say('answering as a Samsung TV — the boot log will hold rather than hand over');
            say(`scenarios: ${Object.keys(SCENARIOS).concat('slow').map((s) => `?boot=${s}`).join('  ')}`);
        });
    }
});

export { devService, SCENARIOS };
