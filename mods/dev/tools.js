// A string compared to a string, so the comparison folds to a constant under the minifier
// and everything behind it is dropped rather than merely skipped. TUBE_DEV=1 to set it.
export const DEV_TOOLS = '__TUBE_DEV_TOOLS__' === 'on';
