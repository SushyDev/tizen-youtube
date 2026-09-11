// Whether a playback should be told its rung, and which.

// A new playback is told even when it is already on the rung, because being on it under Auto is
// not being held there, and telling it costs nothing. Whatever it prefers before that is the
// player's own default. After that, only a ladder grown past what was said is followed, and only
// while what was said still stands: anything else it prefers was picked from its menu.
export function rungToAsk({ chosen, preferred, asked }) {
    if (!chosen || chosen === asked) return null;
    if (asked === null) return chosen;

    const stands = !preferred || preferred === 'auto' || preferred === asked || preferred === chosen;
    return stands ? chosen : null;
}
