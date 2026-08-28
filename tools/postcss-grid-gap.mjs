// `gap` is `grid-gap` until Chromium 66.
//
// This is the single most expensive thing to get wrong in this repo's CSS,
// because getting it wrong is invisible: the stylesheet still parses, every
// rule still applies, and the only symptom is that nothing on the television
// has any spacing. It looks like a design that was never finished rather than
// like a bug, so nobody goes looking for a cause.
//
// The ecosystem plugin for this — postcss-gap-properties — does the right
// thing for `display: grid` and silently does nothing for `display:
// inline-grid`, even though Chromium 57 accepts `grid-gap` on both. Every
// button in this interface is an inline-grid, so that gap covered exactly the
// controls a person touches.
//
// So this is the whole rule, in one place, where it can be read:
//
//   a rule that lays its children out on a grid and sets a gap also gets the
//   name for that gap that Chromium 57 through 65 understands.
//
// It is emitted *before* the modern property, so a newer engine reads both
// and the later one wins. `tools/css-support.js` checks the built output for
// any gap that came through without its companion, which is what turns this
// from a plugin that is usually applied into a rule that cannot be skipped.

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

            // Idempotent: the plugin may run over CSS that already has the
            // pair, and a second copy would be harmless but confusing.
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
