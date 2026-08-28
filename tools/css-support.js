// What the television cannot parse.
//
// Shared by both pages this repo ships — the television's and the phone's —
// because they land in the same webview and fail the same way.
//
// Tizen's webview fails at CSS in total silence: an at-rule it does not know
// takes the entire stylesheet with it, a selector it cannot parse takes its
// own rule, and nothing is logged anywhere. A stylesheet that vanished this
// way is indistinguishable from one that never loaded, and the only place it
// happens is on hardware — which is how the last one shipped broken.
//
// So this reads the built CSS back and names anything the TV would throw
// away. It runs in the build (see build.js) and in the test suite, because a
// check that only runs when someone remembers is not a check.

// Each entry is something modern CSS offers, the Chromium release that added
// it, and nothing else. Tizen 5.5 is Chromium 63 and Tizen 6.5 is 76, so
// anything above 63 is out — the version is kept because it explains why a
// perfectly ordinary line of CSS is being rejected.
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

// `:focus-visible` is deliberately absent. Chromium 76 drops the one rule that
// uses it and simply keeps the focus ring, which is the safe way to be wrong —
// and the alternative is shipping a JavaScript polyfill to a television to
// style an outline.

// Everything above is a declaration read in isolation. Gaps cannot be, and
// they are the single most expensive thing on this list to get wrong: a
// stylesheet whose every gap is inert still renders, so the page looks
// merely cramped rather than broken, and nothing points at the cause.

const rules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

const SETS_GAP = /(?:^|;)\s*(?:row-|column-)?gap\s*:/;
const SETS_GRID_GAP = /(?:^|;)\s*grid-(?:row-|column-)?gap\s*:/;

// Grid gap has worked since Chromium 57 — but under the name `grid-gap`. The
// unprefixed `gap` is not an alias for it until 66, so on Tizen 5.5 a rule
// with only `gap` lays out with no spacing at all. postcss-gap-properties
// emits both, and only for a rule that also declares `display: grid`, so a
// bare `gap` in the output means one of those two things did not happen.
const unpairedGaps = (css) => rules(css)
    .filter(([, , body]) => SETS_GAP.test(body) && !SETS_GRID_GAP.test(body))
    .map(([, selector]) => `\`gap\` without \`grid-gap\` on \`${selector.trim()}\` — ` +
        'Chromium 66 (declare `display: grid` in the same rule so PostCSS can lower it)');

// Flex gap only arrives in Chromium 84, and no amount of lowering helps.
const flexGaps = (css) => rules(css)
    .filter(([, , body]) => SETS_GAP.test(body) && /display\s*:\s*(?:inline-)?flex/.test(body))
    .map(([, selector]) => `flexbox gap on \`${selector.trim()}\` — Chromium 84 (use a grid instead)`);

/** Everything in this CSS that Chromium 63 would silently discard. */
const unsupportedCss = (css) => [...new Set(
    UNSUPPORTED
        .filter(([pattern]) => pattern.test(css))
        .map(([, name, since]) => `${name} — Chromium ${since}`)
        .concat(flexGaps(css))
        .concat(unpairedGaps(css))
)];

/** The inlined stylesheets of a single-file page. */
const stylesOf = (html) => (html.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join('\n');

export { unsupportedCss, stylesOf };
