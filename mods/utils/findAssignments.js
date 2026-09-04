const ASSIGNMENT = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=(?![=>])/g;

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
