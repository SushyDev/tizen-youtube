// Locates property assignments inside minified YouTube source.
//
// The patch sites below need one thing: given the source text of a YouTube
// class, find the assignment whose right-hand side mentions a marker string,
// and return the property being assigned. The reference implementation did
// that by running esprima over the source and walking the AST with estraverse
// — roughly 150KB of parser shipped to a TV, re-parsing a large minified class
// on every player construction.
//
// A marker-anchored scan gives the same answer for these call sites at a
// fraction of the cost, and lets both parsers leave the bundle.

// Matches `X.prop =` / `X.prop=` but not `==`, `===`, `>=`, `!=` and friends.
const ASSIGNMENT = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=(?![=>])/g;

/**
 * Splits source into assignment records shaped like the AST version's output:
 * `{ left: "X.prop", rhs: "<text up to the next assignment>" }`.
 *
 * Each right-hand side is bounded by the start of the following assignment,
 * which in minified sequential assignments is where it genuinely ends.
 */
export function extractAssignments(code) {
    if (typeof code !== 'string' || !code) return [];

    const matches = [];
    ASSIGNMENT.lastIndex = 0;

    let match;
    while ((match = ASSIGNMENT.exec(code)) !== null) {
        matches.push({
            left: `${match[1]}.${match[2]}`,
            property: match[2],
            start: match.index,
            rhsStart: match.index + match[0].length
        });
    }

    return matches.map((entry, index) => ({
        left: entry.left,
        property: entry.property,
        rhs: code.slice(entry.rhsStart, index + 1 < matches.length ? matches[index + 1].start : code.length)
    }));
}

/**
 * Returns the property name of the first assignment whose right-hand side
 * satisfies `predicate`, or null when nothing matches.
 *
 * Returning null rather than throwing matters: the reference dereferenced
 * `.find(...).left` directly, so a YouTube release that renamed one marker
 * took down the whole player patch with a TypeError.
 */
export function findAssignedProperty(code, predicate) {
    const assignments = extractAssignments(code);

    for (const assignment of assignments) {
        let hit = false;
        try {
            hit = predicate(assignment.rhs);
        } catch (e) {
            hit = false;
        }
        if (hit) return assignment.property;
    }

    return null;
}
