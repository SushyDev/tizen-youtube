// The whole app on a desk.
//
// `npm run dev` used to serve the boot screen and stop there, because the
// boot screen is the only part of this repo that is a page. Everything after
// it — the proxy, the rewrite table, the userscript and every feature in it —
// needed a television.
//
// It does not. The service runs off-TV already: only DIAL and debugger
// injection need the platform, and the proxy path needs neither. So this
// starts the real service beside Vite, and the boot screen hands over to it
// exactly as it would on a TV. What comes up is youtube.com's own TV client,
// through the real proxy, with the real userscript in it.
//
// Three things have to be arranged for that to work off hardware:
//
//   the user agent  youtube.com/tv serves a "you are being redirected" page
//                   to anything that is not a television, so the proxy is
//                   told to present itself as one. See TUBE_DEV_UA.
//
//   the variant     with no platform to ask, the loader would call every
//                   desktop browser a Tizen 3 and serve the legacy bundle.
//                   TUBE_PLATFORM_VERSION says which TV to be; 6.5 by
//                   default, so what runs is what most sets run.
//
//   the keys        the settings panel opens on the green button, which no
//                   keyboard has. dev/remote.js is injected after the
//                   userscript and puts the remote on the keyboard.
//
// It is all `apply: 'serve'` and every one of those is an environment
// variable that nothing sets in a build. None of this can reach a package.

import { spawn } from 'child_process';
import { createServer } from 'net';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

// Where the service binds. Kept in step with service/lib/ports.js, which is
// CommonJS and cannot be imported from a Vite config.
const PROXY_PORT = 8099;

// A Samsung set of the generation this app mostly runs on. Overridable, so a
// page can be looked at as an older TV would be served it.
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
 * Runs the real service and the userscript watcher alongside Vite.
 *
 * `enabled` is false when there is a television to develop against, in which
 * case Vite proxies to the service running on it and starting a second one
 * here would only compete for the port.
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

            // The one thing the shell cannot work out for itself.
            //
            // `proxyUrl` in the state is a localhost URL whichever mode this
            // is in, so off a TV the shell has no way to tell "the service is
            // here, go" from "the service is on a television across the room,
            // and that URL is nothing on this machine". This is the mode
            // where it is here, so this is where it is said. Everything else
            // under /__tube falls through to the proxy below untouched.
            //
            // Registered in configureServer, which runs before Vite installs
            // its own middlewares, so this is reached first.
            server.middlewares.use((request, response, next) => {
                if (request.url.split('?')[0] !== '/__tube/state') return next();

                fetch(`http://localhost:${PROXY_PORT}/__tube/state`)
                    .then((upstream) => upstream.json())
                    .then((state) => {
                        response.setHeader('content-type', 'application/json; charset=utf-8');
                        response.end(JSON.stringify({ ...state, handOver: true }));
                    })
                    // Not answering is a state the shell already handles: it
                    // says so on screen and keeps polling until its deadline.
                    .catch(() => next());
            });

            // Both children inherit stdio through here rather than directly,
            // so their output lands in Vite's stream with a prefix on it and
            // a rollup rebuild is not mistaken for a Vite one.
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
                // Rebuilds the bundles the service serves. The loader reads
                // them from disk on every request, so a rebuild is picked up
                // by the next page load with nothing to restart.
                watcher = start('mods', '\x1b[35m', 'npx', ['rollup', '-c', 'rollup.config.js', '-w'], {
                    cwd: join(ROOT, 'mods')
                });

                if (await portIsFree(PROXY_PORT)) {
                    service = start('svc', '\x1b[33m', process.execPath, ['index.js'], {
                        cwd: join(ROOT, 'service'),
                        env: {
                            // Present as a television upstream, and tell the
                            // page to say the same about itself.
                            TUBE_DEV_UA: process.env.TUBE_DEV_UA || TV_USER_AGENT,
                            // Which TV to be, and so which bundle to serve.
                            TUBE_PLATFORM_VERSION: process.env.TUBE_PLATFORM_VERSION || DEFAULT_PLATFORM_VERSION,
                            // The bundles rollup is writing, rather than
                            // whatever the last `npm run build` left behind.
                            TUBE_BUNDLE_DIR: join(ROOT, 'dist'),
                            // Never the TV's own data directory, and never
                            // shared with anything else.
                            TUBE_CACHE_DIR: join(ROOT, '.dev', 'cache'),
                            // The remote, on a keyboard.
                            TUBE_DEV_INJECT: join(HERE, 'remote.js')
                        }
                    });
                } else {
                    say(`something is already on :${PROXY_PORT} — using it rather than starting a second service`);
                }

                say('the boot screen hands over to youtube; the service is the real one');
                say(`youtube directly: http://localhost:${PROXY_PORT}/tv`);
                say('keys: g opens additional options, escape is return, tubeRemote(code) presses anything');
            });

            // Vite's own signal handling closes the server, which is where
            // both children have to go too — an orphaned service holds :8099
            // and the next run silently talks to a stale build.
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
