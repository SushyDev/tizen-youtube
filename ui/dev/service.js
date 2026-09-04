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
    proxy: { ...BASE, canInject: false, isConnecting: false, injectionFailed: false },

    debugger: { ...BASE, canInject: true, isConnecting: false, injectionFailed: false },

    failed: { ...BASE, canInject: true, isConnecting: false, injectionFailed: true },

    connecting: { ...BASE, canInject: true, isConnecting: true, injectionFailed: false },

    script: {
        ...BASE,
        canInject: false,
        isConnecting: false,
        injectionFailed: false,
        script: { error: 'no cached bundle and the origin is unreachable' }
    }

};

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
