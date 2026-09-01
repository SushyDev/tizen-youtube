// `JSON.parse(JSON.stringify(value))` serialises a whole subtree to text and parses it
// back. A CPU profile of one browse response put 28% of total time in `stringify` and
// much of the rest in re-parsing what it produced — the deep clones taken per tile were
// the single largest cost in the userscript, and they went through this app's own JSON
// patches on the way in and out.
//
// Walking the structure directly is several times faster and allocates far less. The
// inputs are always JSON-parsed responses, so there is nothing here that a round trip
// would have handled and this does not: no functions, no undefined, no cycles, no
// Date or Map. Anything not a plain object or array is returned as-is, which is exactly
// what a round trip does with a primitive.
export function cloneJson(value) {
    if (value === null || typeof value !== 'object') return value;

    if (Array.isArray(value)) {
        const length = value.length;
        const copy = new Array(length);
        for (let i = 0; i < length; i++) copy[i] = cloneJson(value[i]);
        return copy;
    }

    const copy = {};
    for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) copy[key] = cloneJson(value[key]);
    }
    return copy;
}
