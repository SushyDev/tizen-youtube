// A television, for styling the boot log against. Each scenario is a real path through
// `boot.js`, selected by the query string:
//
//   /                 the proxy path
//   /?boot=slow       the service never answers, and it gives up
//   /?boot=script     the userscript could not be resolved

const PROXY_URL = 'http://localhost:8098/tv?additionalDataUrl=' +
    encodeURIComponent('http://localhost:8097/dial/apps/YouTube');

const BASE = {
    platformVersion: '6.5',
    variant: 'modern',
    proxyUrl: PROXY_URL,
    script: { version: '2.0.1', origin: 'https://cdn.example.com/tube', variant: 'modern' }
};

const SCENARIOS = {
    proxy: { ...BASE },

    script: { ...BASE, script: { error: 'no cached bundle and the origin is unreachable' } }

    // `slow` is deliberately absent: it is the absence of an answer, handled below.
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

            response.end(JSON.stringify(state));
        });

        server.httpServer.once('listening', () => {
            say('answering as a Samsung TV — the boot log will hold rather than hand over');
            say(`scenarios: ${Object.keys(SCENARIOS).concat('slow').map((s) => `?boot=${s}`).join('  ')}`);
        });
    }
});

export { devService, SCENARIOS };
