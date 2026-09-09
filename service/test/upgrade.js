'use strict';

// WebSockets through the proxy.
//
// The container reaches the network only through us, and node delivers an upgrade as its own
// `upgrade` event — express never sees it. Nothing listened, so every WebSocket the page opened
// was accepted at the TCP level and then never answered. Found while attaching a remote inspector,
// but nothing about it is dev-only.
//
// No websocket library here: an upgrade is an HTTP request with two headers and a 101, and using
// raw sockets is what makes this a test of the proxy rather than of a client.

const http = require('http');
const net = require('net');

process.env.TUBE_PROXY_HOST = 'tv.example';

const proxy = require('../lib/proxy.js');
const upgrade = require('../lib/upgrade.js');

const results = [];
const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
};

// A server that accepts an upgrade and echoes whatever follows it back, upper-cased.
const target = http.createServer();
target.on('upgrade', (req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\n'
        + 'upgrade: websocket\r\nconnection: Upgrade\r\nx-saw-path: ' + req.url + '\r\n\r\n');
    socket.on('data', (chunk) => socket.write(String(chunk).toUpperCase()));
});

const app = proxy.create('7.0');
proxy.attachFallback(app);

const ask = (server, line, body) => new Promise((done) => {
    const socket = net.connect(server.address().port, '127.0.0.1', () => socket.write(line));
    const seen = { text: '' };
    const timer = setTimeout(() => { socket.destroy(); done({ text: seen.text, timedOut: true }); }, 3000);

    socket.on('data', (chunk) => {
        seen.text += String(chunk);
        if (body && seen.text.indexOf('101') !== -1 && seen.text.indexOf(body.toUpperCase()) === -1) {
            socket.write(body);
        }
        if (!body || seen.text.indexOf(body.toUpperCase()) !== -1) {
            clearTimeout(timer);
            socket.destroy();
            done({ text: seen.text, timedOut: false });
        }
    });
    socket.on('close', () => { clearTimeout(timer); done({ text: seen.text, timedOut: false, closed: true }); });
    socket.on('error', () => { clearTimeout(timer); done({ text: seen.text, error: true }); });
});

const run = async () => {
    await new Promise((r) => target.listen(0, '127.0.0.1', r));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    upgrade.attach(server);

    const where = `127.0.0.1:${target.address().port}`;

    // Absolute-form, which is how a client using us as a proxy asks.
    const proxied = await ask(server,
        `GET http://${where}/socket HTTP/1.1\r\nHost: ${where}\r\n`
        + 'Upgrade: websocket\r\nConnection: Upgrade\r\n\r\n', 'ping');

    check('an upgrade is forwarded and answered 101',
        proxied.text.indexOf('101') !== -1, JSON.stringify(proxied.text.slice(0, 120)));
    check('and it reaches the path that was asked for',
        proxied.text.indexOf('x-saw-path: /socket') !== -1, JSON.stringify(proxied.text.slice(0, 160)));
    check('bytes flow both ways once it is open',
        proxied.text.indexOf('PING') !== -1, JSON.stringify(proxied.text.slice(0, 200)));

    // Origin-form, which is how it arrives over our own TLS front.
    const byHost = await ask(server,
        `GET /socket HTTP/1.1\r\nHost: ${where}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`, 'pong');
    check('an upgrade named only by its Host header is forwarded too',
        byHost.text.indexOf('101') !== -1 && byHost.text.indexOf('PONG') !== -1,
        JSON.stringify(byHost.text.slice(0, 160)));

    // The whole point: a dead end must end the socket, never hold it open.
    const nowhere = await ask(server,
        'GET http://127.0.0.1:9/socket HTTP/1.1\r\nHost: 127.0.0.1:9\r\n'
        + 'Upgrade: websocket\r\nConnection: Upgrade\r\n\r\n', null);
    check('an upgrade that cannot be forwarded is closed, not left hanging',
        !nowhere.timedOut, 'the socket was still open after 3s — this is the bug it was written for');

    target.close();
    server.close();

    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
};

run();
