'use strict';

// http2 arrived in node 8.4.

const load = () => {
    try {
        return require('http2');
    } catch (e) {
        return null;
    }
};

const absent = () => {
    throw new Error('this runtime has no http2');
};

module.exports = load() || { connect: absent };
