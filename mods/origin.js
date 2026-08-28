// Where remote assets come from.
//
// A self-hosted origin behind Cloudflare, not jsDelivr. Versioned paths are
// immutable and cached at the edge; the build replaces __TUBE_VERSION__ with
// the real version so a cached asset can never be served for the wrong build.

// Both tokens are substituted at build time from tizen.config.json.
export const ORIGIN = '__TUBE_ORIGIN__';
export const VERSION = '__TUBE_VERSION__';

export function assetUrl(path) {
    return `${ORIGIN}/${VERSION}/${path}`;
}
