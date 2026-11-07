'use strict';

const { serviceAddress } = require('./serviceAddress.js');

const EVERY = Number(process.env.TUBE_ADDRESS_EVERY_MS) || 10000;

// Calls changed(from, to) when the address the container is sent to moves, for instance after a DHCP renewal.
const watch = (changed, every) => {
    const held = { address: serviceAddress() };

    const look = () => {
        const now = serviceAddress();
        if (now === held.address) return;

        const was = held.address;
        held.address = now;
        changed(was, now);
    };

    const timer = setInterval(look, every || EVERY);
    if (typeof timer.unref === 'function') timer.unref();

    return { look, stop: () => clearInterval(timer) };
};

module.exports = { watch };
