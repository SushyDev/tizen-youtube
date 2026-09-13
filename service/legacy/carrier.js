'use strict';

// Node 4's http parser still owns a CONNECT socket, and native TLS over it aborts the process.

const { Duplex } = require('stream');

// Relayed through a JS stream, which TLS wraps instead of taking the socket from the parser.
module.exports = (socket) => {
    const relay = new Duplex({
        read: () => socket.resume(),
        write: (chunk, encoding, done) => socket.write(chunk, done)
    });

    socket.on('data', (chunk) => {
        if (!relay.push(chunk)) socket.pause();
    });
    socket.on('end', () => relay.push(null));
    socket.on('error', (error) => relay.emit('error', error));
    socket.on('close', () => relay.emit('close'));

    relay.on('finish', () => socket.end());

    // Node 4's Duplex has no destroy, and the TLS wrap calls it on close.
    relay.destroy = () => socket.destroy();

    return relay;
};
