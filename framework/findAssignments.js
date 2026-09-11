const ASSIGNMENT = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=(?![=>])/g;

function extractAssignments(code) {
    if (typeof code !== 'string' || !code) return [];

    const from = (at) => {
        ASSIGNMENT.lastIndex = at;
        const match = ASSIGNMENT.exec(code);
        if (!match) return [];

        return [{
            left: `${match[1]}.${match[2]}`,
            property: match[2],
            start: match.index,
            rhsStart: match.index + match[0].length
        }].concat(from(ASSIGNMENT.lastIndex));
    };

    const found = from(0);

    return found.map((entry, index) => ({
        left: entry.left,
        property: entry.property,
        rhs: code.slice(entry.rhsStart, index + 1 < found.length ? found[index + 1].start : code.length)
    }));
}

export function findAssignedProperty(code, predicate) {
    const matches = (assignment) => {
        try {
            return !!predicate(assignment.rhs);
        } catch (e) {
            return false;
        }
    };

    const hit = extractAssignments(code).find(matches);

    return hit ? hit.property : null;
}
