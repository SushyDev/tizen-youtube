// A string comparison, so the minifier folds it and drops every dev-only branch.
// The cast is for the type checker only: before rollup substitutes, both sides really are
// literals that cannot match, which is exactly what makes the fold work.
export const DEV_TOOLS = /** @type {string} */ ('__TUBE_DEV_TOOLS__') === 'on';
