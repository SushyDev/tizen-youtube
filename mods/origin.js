export const ORIGIN = '__TUBE_ORIGIN__';
export const VERSION = '__TUBE_VERSION__';

export const COMMIT = '__TUBE_COMMIT__';
export const TREE = '__TUBE_TREE__';

export function assetUrl(path) {
    return `${ORIGIN}/${VERSION}/${path}`;
}
