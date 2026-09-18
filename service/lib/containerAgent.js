'use strict';

// Cobalt names itself on every CONNECT, and nothing else on the set says what the container is.
const held = { agent: null };

const pick = (pattern) => (pattern.exec(held.agent || '') || [])[1] || null;

// True only the first time an agent is seen, so the caller logs it once rather than per tunnel.
const remember = (seen) => {
    if (!seen || held.agent === seen) return false;

    held.agent = seen;
    return true;
};

const agent = () => held.agent;

// Separates a 2025 set from an earlier one on the same Tizen version.
const build = () => pick(/Tizen\/[\d.]+\/(\S+?)[);\s]/);

const engine = () => [
    ['cobalt', pick(/Cobalt\/(\S+)/)],
    ['evergreen', pick(/Evergreen\/(\S+)/)],
    ['starboard', pick(/Starboard\/(\d+)/)]
].filter((named) => named[1]).map((named) => `${named[0]} ${named[1]}`).join(', ') || null;

module.exports = { remember, agent, build, engine };
