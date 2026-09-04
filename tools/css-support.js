const UNSUPPORTED = [
    [/@layer\b/, '@layer', 99],
    [/@property\b/, '@property', 85],
    [/@container\b/, '@container', 105],
    [/@scope\b/, '@scope', 118],
    [/@custom-media\b/, '@custom-media', 'never — PostCSS should have resolved it'],
    [/color-mix\(/, 'color-mix()', 111],
    [/(?<![\w-])(?:oklch|oklab|lch|lab|hwb|color)\(/, 'a modern colour function', 111],
    [/:where\(/, ':where()', 88],
    [/(?<![\w-]):is\(/, ':is()', 88],
    [/\bclamp\(/, 'clamp()', 79],
    [/conic-gradient\(/, 'conic-gradient()', 69],
    [/(?<![\w-])(?:min|max)\(/, 'min() / max()', 79],
    [/\baspect-ratio\s*:/, 'aspect-ratio', 88],
    [/(?<![\w-])inset\s*:/, 'inset', 87],
    [/\b(?:margin|padding|border|inset)-(?:block|inline)\b/, 'a logical property', 87]
];

const rules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

const SETS_GAP = /(?:^|;)\s*(?:row-|column-)?gap\s*:/;
const SETS_GRID_GAP = /(?:^|;)\s*grid-(?:row-|column-)?gap\s*:/;

const unpairedGaps = (css) => rules(css)
    .filter(([, , body]) => SETS_GAP.test(body) && !SETS_GRID_GAP.test(body))
    .map(([, selector]) => `\`gap\` without \`grid-gap\` on \`${selector.trim()}\` — ` +
        'Chromium 66 (declare `display: grid` in the same rule so PostCSS can lower it)');

const flexGaps = (css) => rules(css)
    .filter(([, , body]) => SETS_GAP.test(body) && /display\s*:\s*(?:inline-)?flex/.test(body))
    .map(([, selector]) => `flexbox gap on \`${selector.trim()}\` — Chromium 84 (use a grid instead)`);

const unsupportedCss = (css) => [...new Set(
    UNSUPPORTED
        .filter(([pattern]) => pattern.test(css))
        .map(([, name, since]) => `${name} — Chromium ${since}`)
        .concat(flexGaps(css))
        .concat(unpairedGaps(css))
)];

const stylesOf = (html) => (html.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join('\n');

export { unsupportedCss, stylesOf };
