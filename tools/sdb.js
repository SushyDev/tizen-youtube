'use strict';

// Runs a command on the television's sdb, through Tizen Homebrew's relay. sdbd only
// accepts connections from 127.0.0.1, so a computer has to ask Homebrew to make them.
// The relay is switched on for the command and off again afterwards.
//
//   npm run sdb -- --tv=192.168.1.29 --pin=000000 "getduid"

const WebSocket = require('ws');

const PORT = 8091;
const DEFAULT_TIMEOUT = 30000;

/** Opens the relay, runs each command in turn, and closes it again. */
function relay({ host, pin, commands, timeout = DEFAULT_TIMEOUT, onLog = () => {} }) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://${host}:${PORT}`);
        const send = (type, payload) => socket.send(JSON.stringify({ type, payload: payload || {} }));

        const results = [];
        let queue = commands.slice();
        let greeted = false;
        let relayWasOn = null;
        let current = null;
        let finished = false;

        const deadline = setTimeout(
            () => finish(new Error(`Tizen Homebrew did not answer on ${host}:${PORT} in time.`)),
            timeout + 15000
        );

        function finish(error, value) {
            if (finished) return;
            finished = true;
            clearTimeout(deadline);

            // A failed command must not leave a shell open behind it.
            const close = () => {
                try { socket.close(); } catch (e) { /* already gone */ }
                if (error) reject(error); else resolve(value);
            };

            if (relayWasOn === false && socket.readyState === WebSocket.OPEN) {
                try {
                    send('setRelay', { enabled: false });
                    onLog('turned the command relay back off');
                    return setTimeout(close, 250);
                } catch (e) { /* fall through */ }
            }

            close();
        }

        /** Runs the next command, or puts the relay back as it was found and stops. */
        function next() {
            if (!queue.length) {
                // Only turn it off if we were the ones who turned it on.
                if (relayWasOn === false) send('setRelay', { enabled: false });
                return setTimeout(() => finish(null, results), 250);
            }
            current = queue.shift();
            onLog(`> ${current}`);
            send('relayExec', { id: String(results.length), command: current, timeout });
        }

        socket.on('open', () => onLog(`connected to ${host}:${PORT}`));

        socket.on('message', (raw) => {
            let message;
            try { message = JSON.parse(raw); } catch (e) { return; }
            const { type, payload = {} } = message;

            if (type === 'hello' && !greeted) {
                greeted = true;
                return send('hello', { pin });
            }

            if (type === 'hello' && payload.ok === false) {
                return finish(new Error('That PIN was refused. It is regenerated every time the service starts.'));
            }

            if (type === 'relayState') {
                if (relayWasOn === null) {
                    relayWasOn = payload.enabled;
                    if (!payload.enabled) {
                        onLog('turning the command relay on');
                        return send('setRelay', { enabled: true });
                    }
                    onLog('the command relay was already on; leaving it that way');
                    return next();
                }
                if (payload.enabled && current === null) return next();
                return;
            }

            if (type === 'relayEnd') {
                results.push({ command: current, output: payload.output || '', truncated: !!payload.truncated });
                current = null;
                return next();
            }

            if (type === 'error') {
                return finish(new Error(`${payload.code}: ${payload.message}`));
            }
        });

        socket.on('error', (error) => finish(new Error(`Could not reach the relay: ${error.message}`)));
        socket.on('close', () => {
            if (!finished) finish(new Error('The relay closed the connection.'));
        });
    });
}

/** The same, retried: sdbd refuses most attempts, and each one is a fresh session. */
async function relayWithRetries(options) {
    const attempts = options.attempts || 12;
    const onLog = options.onLog || (() => {});
    let last = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await relay(options);
        } catch (error) {
            last = error;
            if (!/sdbRefused|debugIpWrong|sdbClosed|sdbTimeout|handshake/i.test(error.message)) throw error;
            onLog(`attempt ${attempt}/${attempts} refused by sdbd`);
            await new Promise((resolve) => setTimeout(resolve, 1500));
        }
    }

    throw last;
}

module.exports = { relay, relayWithRetries };

if (require.main === module) {
    const args = process.argv.slice(2);
    const flags = {};
    const rest = [];
    args.forEach((arg) => {
        if (arg.indexOf('--') === 0) {
            const [key, value] = arg.replace(/^--/, '').split('=');
            flags[key] = value === undefined ? true : value;
        } else rest.push(arg);
    });

    if (!flags.tv || !flags.pin || !rest.length) {
        console.error('usage: npm run sdb -- --tv=<ip> --pin=<pin> "<command>" ["<command>" ...]');
        process.exit(2);
    }

    relayWithRetries({
        host: flags.tv,
        pin: String(flags.pin),
        commands: rest,
        attempts: Number(flags.attempts || 12),
        timeout: Number(flags.timeout || 30000),
        onLog: (m) => console.error(`  ${m}`)
    })
        .then((results) => {
            results.forEach((r) => {
                console.log(`\n$ ${r.command}`);
                console.log(r.output.trimEnd() || '(no output)');
                if (r.truncated) console.log('(truncated)');
            });
        })
        .catch((error) => {
            console.error(`\n${error.message}\n`);
            process.exit(1);
        });
}
