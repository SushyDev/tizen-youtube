// Both tokens below are substituted at build time from tizen.config.json.
export const ORIGIN = '__TUBE_ORIGIN__';
export const VERSION = '__TUBE_VERSION__';

export function assetUrl(path) {
    return `${ORIGIN}/${VERSION}/${path}`;
}
