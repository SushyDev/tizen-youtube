// Where remote assets come from: a self-hosted origin behind Cloudflare, not jsDelivr.
// Versioned paths are immutable and cached at the edge. Both tokens below are
// substituted at build time from tizen.config.json.
export const ORIGIN = '__TUBE_ORIGIN__';
export const VERSION = '__TUBE_VERSION__';

export function assetUrl(path) {
    return `${ORIGIN}/${VERSION}/${path}`;
}
