const ASSIGNMENT = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=(?![=>])/g;

// replace() as the visitor, not matchAll(): matchAll is Chrome 73 and the floor is Cobalt 3.2.1.
// replace resets the /g cursor itself, which is what the hand-rolled while loop was really for.
function extractAssignments(code) {
    if (typeof code !== 'string' || !code) return [];

    const found = [];

    code.replace(ASSIGNMENT, (whole, left, property, at) => {
        found.push({
            left: `${left}.${property}`,
            property,
            start: at,
            rhsStart: at + whole.length
        });

        return whole;
    });

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
