// Given a minified YouTube class's source, find the assignment whose right-hand side
// mentions a marker and return the property assigned. The reference did this with
// esprima and estraverse — 150KB of parser shipped to a TV, re-parsing on every player
// construction. A marker-anchored scan gives the same answer for these call sites.

// Matches `X.prop =` / `X.prop=` but not `==`, `===`, `>=`, `!=` and friends.
const ASSIGNMENT = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=(?![=>])/g;

/**
 * Splits source into `{ left: "X.prop", rhs: "<text up to the next assignment>" }`.
 * Each right-hand side is bounded by the start of the following assignment, which in
 * minified sequential assignments is where it genuinely ends.
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
 * The property name of the first assignment whose right-hand side satisfies
 * `predicate`, or null. Null rather than a throw: the reference dereferenced
 * `.find(...).left` directly, so a renamed marker took down the whole player patch.
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
