// What the television cannot parse. Tizen's webview fails at CSS in silence: an unknown
// at-rule takes the whole stylesheet, an unparseable selector takes its own rule, and
// nothing is logged.
//
// Each entry below is a feature and the Chromium release that added it. Tizen 5.5 is
// Chromium 63 and 6.5 is 76, so anything above 63 is out.
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

// `:focus-visible` is deliberately absent: Chromium 76 drops the one rule that uses it
// and keeps the focus ring, which is the safe way to be wrong.

const rules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

const SETS_GAP = /(?:^|;)\s*(?:row-|column-)?gap\s*:/;
const SETS_GRID_GAP = /(?:^|;)\s*grid-(?:row-|column-)?gap\s*:/;

// Grid gap has worked since Chromium 57, under the name `grid-gap`. The unprefixed `gap`
// is not an alias until 66, so on Tizen 5.5 a rule with only `gap` has no spacing at all.
// postcss-gap-properties emits both, but only for a rule that also declares
// `display: grid`.
const unpairedGaps = (css) => rules(css)
    .filter(([, , body]) => SETS_GAP.test(body) && !SETS_GRID_GAP.test(body))
    .map(([, selector]) => `\`gap\` without \`grid-gap\` on \`${selector.trim()}\` — ` +
        'Chromium 66 (declare `display: grid` in the same rule so PostCSS can lower it)');

// Flex gap only arrives in Chromium 84, and no amount of lowering helps.
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
