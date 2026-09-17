// A new playback is told even when it already shows the rung, because being on it under Auto is
// not being held there.
export function rungToAsk({ chosen, preferred, asked }) {
    if (!chosen || chosen === asked) return null;
    if (asked === null) return chosen;

    // Anything else the playback prefers was picked from its own menu.
    const stands = !preferred || preferred === 'auto' || preferred === asked || preferred === chosen;
    return stands ? chosen : null;
}
