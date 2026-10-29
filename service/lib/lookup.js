'use strict';

const dgram = require('dgram');
const dns = require('dns');

// On some sets every new connection waits 5 s, sometimes 10, in getaddrinfo: about one DNS packet
// in ten is lost on the Wi-Fi, glibc waits 5 s before asking again, and node keeps no cache. The
// same servers asked directly answer in 20-50 ms, so we ask them ourselves, all at once, again
// every RETRY_AFTER, and keep the answer.
const RETRY_AFTER = 400;
const ROUNDS = 6;
const KEEP_FOR = 5 * 60 * 1000;

const IPV4 = /^\d+\.\d+\.\d+\.\d+$/;
const NAME = /^[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;

const known = new Map();

// Buffer.alloc arrived in node 4.5.
const zeroed = (size) => (Buffer.alloc ? Buffer.alloc(size) : new Buffer(size).fill(0));

// One A question, recursion desired.
const question = (id, name) => {
    const labels = name.split('.');
    const packet = zeroed(12 + labels.reduce((size, label) => size + label.length + 1, 0) + 5);

    packet.writeUInt16BE(id, 0);
    packet.writeUInt16BE(0x0100, 2);
    packet.writeUInt16BE(1, 4);

    const end = labels.reduce((at, label) => {
        packet[at] = label.length;
        packet.write(label, at + 1, 'ascii');
        return at + label.length + 1;
    }, 12);

    packet.writeUInt16BE(1, end + 1);
    packet.writeUInt16BE(1, end + 3);

    return packet;
};

// -1 for a name that runs off the end.
const pastName = (packet, at) => {
    if (at < 0 || at >= packet.length) return -1;
    if (packet[at] === 0) return at + 1;
    if ((packet[at] & 0xc0) === 0xc0) return at + 2;

    return pastName(packet, at + packet[at] + 1);
};

const pastQuestions = (packet, at, left) => {
    if (left === 0 || at < 0) return at;

    const named = pastName(packet, at);
    return pastQuestions(packet, named < 0 ? -1 : named + 4, left - 1);
};

const addressAmong = (packet, start, left) => {
    const at = left > 0 ? pastName(packet, start) : -1;
    if (at < 0 || at + 10 > packet.length) return null;

    const type = packet.readUInt16BE(at);
    const length = packet.readUInt16BE(at + 8);
    const data = at + 10;

    if (type === 1 && length === 4 && data + 4 <= packet.length) {
        return `${packet[data]}.${packet[data + 1]}.${packet[data + 2]}.${packet[data + 3]}`;
    }

    return addressAmong(packet, data + length, left - 1);
};

// The first A record among the answers; a recursive server sends the CNAME chain ahead of it.
const firstAddress = (packet) => addressAmong(packet,
    pastQuestions(packet, 12, packet.readUInt16BE(4)), packet.readUInt16BE(6));

const servers = () => {
    try {
        return dns.getServers().filter((server) => IPV4.test(server));
    } catch (e) {
        return [];
    }
};

// Settles with null rather than failing: the caller then connects by name as before.
const ask = (name) => new Promise((settle) => {
    const asked = servers();
    if (!asked.length) return settle(null);

    const id = 1 + Math.floor(Math.random() * 65534);
    const packet = question(id, name);
    const socket = dgram.createSocket('udp4');
    const held = { rounds: 0, refused: 0, done: false, timer: null };

    const finish = (address) => {
        if (held.done) return;

        held.done = true;
        clearTimeout(held.timer);
        try { socket.close(); } catch (e) { /* already closed */ }
        settle(address);
    };

    // Answers only from the servers we asked, so nothing else on the network can name an address.
    socket.on('message', (message, from) => {
        if (asked.indexOf(from.address) === -1 || message.length < 12 || message.readUInt16BE(0) !== id) return;

        const address = (message[3] & 0x0f) === 0 ? firstAddress(message) : null;
        if (address) finish(address);
        else if ((held.refused += 1) >= asked.length) finish(null);
    });
    socket.on('error', () => finish(null));

    const send = () => {
        if (held.done) return;
        if (held.rounds === ROUNDS) {
            finish(null);
            return;
        }

        held.rounds += 1;
        asked.forEach((server) => socket.send(packet, 0, packet.length, 53, server));
        held.timer = setTimeout(send, RETRY_AFTER);
    };

    return send();
});

// One question in flight per name. A stale answer is handed out at once while a fresh one is
// asked for, so a long session never waits on the resolver again.
const refresh = (name) => {
    const entry = known.get(name) || { address: null, at: 0, asking: null };
    known.set(name, entry);

    if (!entry.asking) {
        entry.asking = ask(name).then((address) => {
            entry.asking = null;

            if (address) {
                entry.address = address;
                entry.at = Date.now();
            }

            return entry.address;
        });
    }

    return entry.asking;
};

// The address to connect to, or null to leave the name to the system resolver.
const resolve = (name) => {
    if (!NAME.test(name) || IPV4.test(name)) return Promise.resolve(null);

    const entry = known.get(name);
    if (entry && entry.address) {
        if (Date.now() - entry.at > KEEP_FOR) refresh(name);
        return Promise.resolve(entry.address);
    }

    return refresh(name);
};

// After a connection to it failed, the address may be the reason.
const forget = (name) => {
    known.delete(name);
};

const warm = (names) => names.forEach((name) => resolve(name));

module.exports = { resolve, forget, warm, question, firstAddress };
