// `gap` is `grid-gap` until Chromium 66, and getting it wrong is invisible: the CSS still
// parses and nothing on the television has any spacing. postcss-gap-properties skips
// `display: inline-grid`, which every button in this interface is — so this emits the
// legacy name before the modern one, and css-support.js fails the build on any gap that
// came through without it.

const LEGACY = {
    gap: 'grid-gap',
    'row-gap': 'grid-row-gap',
    'column-gap': 'grid-column-gap'
};

const GRID = /^\s*(?:inline-)?grid\s*$/;

const gridGap = () => ({
    postcssPlugin: 'grid-gap',

    Rule(rule) {
        let onAGrid = false;
        const gaps = [];

        rule.each((node) => {
            if (node.type !== 'decl') return;

            if (node.prop === 'display' && GRID.test(node.value)) onAGrid = true;
            if (LEGACY[node.prop]) gaps.push(node);
        });

        if (!onAGrid) return;

        gaps.forEach((declaration) => {
            const legacy = LEGACY[declaration.prop];

            // Idempotent: the plugin may run over CSS that already has the pair.
            const already = declaration.parent.some(
                (node) => node.type === 'decl' && node.prop === legacy
            );

            if (already) return;

            declaration.cloneBefore({ prop: legacy });
        });
    }
});

gridGap.postcss = true;

export { gridGap };
