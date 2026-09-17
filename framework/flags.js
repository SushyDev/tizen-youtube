// A string comparison, so the minifier folds it and drops every dev-only branch.
export const DEV_TOOLS = /** @type {string} */ ('__TUBE_DEV_TOOLS__') === 'on';
