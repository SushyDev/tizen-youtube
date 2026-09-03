// Whether this bundle carries its development tooling.
//
// Baked at build time, as a string compared to a string, so the source stays valid
// JavaScript and the comparison folds to a constant when the bundle is minified — which
// lets everything behind it be dropped rather than merely skipped.
//
//     npm run package                 without it
//     TUBE_DEV=1 npm run package      with it
//
// What hangs off this is not free. The bridge polls the service five times a second,
// pushes a reading every second and opens a port that evaluates whatever is posted to it;
// the probe reads apart every player request and response and holds what it found; and both
// journals build lines for a reader who, on a television somebody is watching, is not there.
export const DEV_TOOLS = '__TUBE_DEV_TOOLS__' === 'on';
