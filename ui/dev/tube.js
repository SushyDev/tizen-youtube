// Runs the real service beside Vite so the whole app works off-TV: only DIAL and
// debugger injection need the platform. TUBE_DEV_UA presents as a television upstream,
// TUBE_PLATFORM_VERSION picks which bundle the loader serves, and dev/remote.js puts
// the remote on the keyboard. All `apply: 'serve'`, so none of it can reach a package.

import { spawn } from 'child_process';
import { createServer } from 'net';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

// Kept in step with service/lib/ports.js, which cannot be imported from a Vite config.
const PROXY_PORT = 8099;

// A Samsung set of the generation this app mostly runs on.
const TV_USER_AGENT = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) 94.0.4606.31/6.5 TV Safari/537.36';

const DEFAULT_PLATFORM_VERSION = '6.5';

/** Whether something already holds the port. */
function portIsFree(port) {
    return new Promise((resolve) => {
        const probe = createServer();
        probe.once('error', () => resolve(false));
        probe.once('listening', () => probe.close(() => resolve(true)));
        probe.listen(port, '127.0.0.1');
    });
}

/**
 * Runs the real service and the userscript watcher alongside Vite. `enabled` is false
 * when there is a television to develop against, where a second service would only
 * compete for the port.
 */
const tubeService = ({ enabled }) => {
    let service = null;
    let watcher = null;

    return {
        name: 'tube-service',
        apply: 'serve',

        configureServer(server) {
            if (!enabled) return;

            const log = server.config.logger;
            const say = (message) => log.info(`  \x1b[36mtube\x1b[0m  ${message}`);

            // `proxyUrl` is a localhost URL in both modes, so off a TV the shell cannot
            // tell "the service is here" from "it is on a television across the room".
            // This is the mode where it is here. Registered before Vite's middlewares.
            server.middlewares.use((request, response, next) => {
                if (request.url.split('?')[0] !== '/__tube/state') return next();

                fetch(`http://localhost:${PROXY_PORT}/__tube/state`)
                    .then((upstream) => upstream.json())
                    .then((state) => {
                        response.setHeader('content-type', 'application/json; charset=utf-8');
                        response.end(JSON.stringify({ ...state, handOver: true }));
                    })
                    // The shell already handles no answer: it says so and keeps polling.
                    .catch(() => next());
            });

            // Both children inherit stdio here so their output lands in Vite's stream.
            const relay = (label, colour, stream) => {
                let pending = '';
                stream.on('data', (chunk) => {
                    pending += chunk.toString();
                    const lines = pending.split('\n');
                    pending = lines.pop();
                    lines.filter((line) => line.trim())
                        .forEach((line) => log.info(`  ${colour}${label}\x1b[0m  ${line.trim()}`));
                });
            };

            const start = (label, colour, command, args, options) => {
                const child = spawn(command, args, {
                    cwd: options.cwd,
                    env: { ...process.env, ...(options.env || {}) },
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                relay(label, colour, child.stdout);
                relay(label, colour, child.stderr);

                child.on('error', (error) => log.error(`  ${colour}${label}\x1b[0m  ${error.message}`));
                child.on('exit', (code) => {
                    // A clean exit is what killing it on shutdown looks like.
                    if (code) log.error(`  ${colour}${label}\x1b[0m  exited with code ${code}`);
                });

                return child;
            };

            server.httpServer.once('listening', async () => {
                // The loader reads the bundles from disk per request, so a rebuild
                // needs no restart.
                watcher = start('mods', '\x1b[35m', 'npx', ['rollup', '-c', 'rollup.config.js', '-w'], {
                    cwd: join(ROOT, 'mods')
                });

                if (await portIsFree(PROXY_PORT)) {
                    service = start('svc', '\x1b[33m', process.execPath, ['index.js'], {
                        cwd: join(ROOT, 'service'),
                        env: {
                            TUBE_DEV_UA: process.env.TUBE_DEV_UA || TV_USER_AGENT,
                            // Which TV to be, and so which bundle to serve.
                            TUBE_PLATFORM_VERSION: process.env.TUBE_PLATFORM_VERSION || DEFAULT_PLATFORM_VERSION,
                            // The bundles rollup is writing, not the last `npm run build`.
                            TUBE_BUNDLE_DIR: join(ROOT, 'dist'),
                            TUBE_CACHE_DIR: join(ROOT, '.dev', 'cache'),
                            TUBE_DEV_INJECT: join(HERE, 'remote.js')
                        }
                    });
                } else {
                    say(`something is already on :${PROXY_PORT} — using it rather than starting a second service`);
                }

                say('the boot screen hands over to youtube; the service is the real one');
                say(`youtube directly: http://localhost:${PROXY_PORT}/tv`);
                say('keys: b is the blue button, escape is return, tubeRemote(code) presses anything');
            });

            // An orphaned service holds the port and the next run talks to a stale build.
            const stop = () => {
                if (service) service.kill();
                if (watcher) watcher.kill();
                service = null;
                watcher = null;
            };

            server.httpServer.once('close', stop);
            process.once('exit', stop);
        }
    };
};

export { tubeService, PROXY_PORT, TV_USER_AGENT };
