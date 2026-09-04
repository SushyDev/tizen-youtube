export const ORIGIN = '__TUBE_ORIGIN__';
export const VERSION = '__TUBE_VERSION__';

export function assetUrl(path) {
    return `${ORIGIN}/${VERSION}/${path}`;
}
