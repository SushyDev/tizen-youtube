'use strict';

// Cobalt names itself on every request, and nothing else on the set says what the container is.
const held = { agent: null };

const pick = (pattern) => (pattern.exec(held.agent || '') || [])[1] || null;

// Anything can reach this port, and the first request after a start would otherwise be taken for
// the container.
const isContainer = (seen) => /\bCobalt\//.test(seen);

// True only the first time an agent is seen, so the caller logs it once rather than per request.
const remember = (seen) => {
    if (!seen || !isContainer(seen) || held.agent === seen) return false;

    held.agent = seen;
    return true;
};

const agent = () => held.agent;

// Tizen 9 writes "Tizen/9.0/<build>" and Tizen 10 "Tizen; /10.0/<build>", so the build is found
// by the slash before it.
const build = () => pick(/Tizen[;/\s]*\/?[\d.]+\/(\S+?)[);\s]/);

const engine = () => [
    ['cobalt', pick(/Cobalt\/(\S+)/)],
    ['evergreen', pick(/Evergreen\/(\S+)/)],
    ['starboard', pick(/Starboard\/(\d+)/)]
].filter((named) => named[1]).map((named) => `${named[0]} ${named[1]}`).join(', ') || null;

module.exports = { remember, agent, build, engine };
