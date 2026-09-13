const pick = (pattern) => (pattern.exec(navigator.userAgent || '') || [])[1] || null;

// Cobalt, Evergreen and Starboard, from the user agent.
export const engine = () => {
    const evergreen = pick(/Evergreen\/(\S+)/);
    const starboard = pick(/Starboard\/(\d+)/);

    return `cobalt ${pick(/Cobalt\/(\S+)/) || 'unknown'}`
        + (evergreen ? `, evergreen ${evergreen}` : '')
        + (starboard ? `, starboard ${starboard}` : '');
};
