import { GRID, MenuServiceItemRenderer, PIVOT, SHELF, TILES, clone, onTile } from '../../framework/index.js';
import { longPressData } from './items.js';

// Most tiles arrive with a menu from the container, so the usual job is appending one item to it.

const addLongPress = (item) => {
    if (!item.tileRenderer) return;
    if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') return;

    if (item.tileRenderer.onLongPressCommand?.showMenuCommand?.menu?.menuRenderer?.items) {
        const copiedItem = clone(item);
        item.tileRenderer.onLongPressCommand.showMenuCommand.menu.menuRenderer.items.push(MenuServiceItemRenderer('Add to Queue', {
            clickTrackingParams: null,
            playlistEditEndpoint: {
                customAction: {
                    action: 'ADD_TO_QUEUE',
                    parameters: copiedItem
                }
            }
        }));
        return;
    }

    if (!item.tileRenderer.metadata?.tileMetadataRenderer) return;
    if (!item.tileRenderer.header?.tileHeaderRenderer?.thumbnail?.thumbnails) return;
    if (!item.tileRenderer.onSelectCommand?.watchEndpoint) return;
    const copiedItem = clone(item);
    const subtitleNode = copiedItem.tileRenderer.metadata.tileMetadataRenderer.lines?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text;
    if (!subtitleNode) return;
    const data = longPressData({
        videoId: copiedItem.tileRenderer.contentId,
        thumbnails: copiedItem.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails,
        title: copiedItem.tileRenderer.metadata.tileMetadataRenderer.title.simpleText,
        subtitle: subtitleNode.runs ? subtitleNode.runs[0].text : subtitleNode.simpleText,
        watchEndpointData: copiedItem.tileRenderer.onSelectCommand.watchEndpoint,
        item: copiedItem
    });
    item.tileRenderer.onLongPressCommand = data;
};

onTile('long press', [SHELF, PIVOT, TILES, GRID], addLongPress);
