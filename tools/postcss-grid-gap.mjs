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
