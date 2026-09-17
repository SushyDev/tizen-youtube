const overlayPanelItemListRenderer = (items, selectedIndex) => ({
    overlayPanelItemListRenderer: {
        items,
        selectedIndex
    }
});

// Title, icons and subtitle are left off entirely rather than sent empty: an empty `title` draws
// as a blank line.
const buttonItem = (title, icon, commands) => ({
    compactLinkRenderer: Object.assign(
        { serviceEndpoint: { commandExecutorCommand: { commands } } },
        title ? { title: { simpleText: title.title } } : {},
        title && title.subtitle ? { subtitle: { simpleText: title.subtitle } } : {},
        icon && icon.icon ? { icon: { iconType: icon.icon } } : {},
        icon && icon.secondaryIcon ? { secondaryIcon: { iconType: icon.secondaryIcon } } : {}
    )
});

const timelyAction = (text, icon, command, triggerTimeMs, timeoutMs) => ({
    timelyActionRenderer: {
        actionButtons: [{
            buttonRenderer: {
                isDisabled: false,
                text: { runs: [{ text }] },
                icon: { iconType: icon },
                trackingParams: null,
                command
            }
        }],
        triggerTimeMs,
        timeoutMs,
        type: ''
    }
});

const MenuServiceItemRenderer = (text, serviceEndpoint) => ({
    menuServiceItemRenderer: {
        text: { runs: [{ text }] },
        serviceEndpoint,
        trackingParams: null
    }
});

const MenuNavigationItemRenderer = (text, navigateEndpoint) => ({
    menuNavigationItemRenderer: {
        text: { runs: [{ text }] },
        navigationEndpoint: navigateEndpoint,
        trackingParams: null
    }
});

const ShelfRenderer = (simpleText, items, selectedIndex = 0) => ({
    shelfRenderer: {
        shelfHeaderRenderer: {
            title: { simpleText }
        },
        tvhtml5ShelfRendererType: 'TVHTML5_SHELF_RENDERER_TYPE_GRID',
        content: {
            horizontalListRenderer: {
                items,
                selectedIndex,
                visibleItemCount: 3
            }
        }
    }
});

const TileRenderer = (simpleText, onSelectCommand) => ({
    tileRenderer: {
        contentType: 'TILE_CONTENT_TYPE_VIDEO',
        metadata: {
            tileMetadataRenderer: {
                title: { simpleText }
            }
        },
        onSelectCommand,
        style: 'TILE_STYLE_YTLR_DEFAULT'
    }
});

// The bare renderer rather than an envelope: the transport controls hold these under `button`.
const ButtonRenderer = (disabled, text, iconType, command) => ({
    isDisabled: disabled,
    text: { runs: [{ text }] },
    icon: { iconType },
    command,
    trackingParams: null
});

export {
    overlayPanelItemListRenderer,
    buttonItem,
    timelyAction,
    MenuServiceItemRenderer,
    MenuNavigationItemRenderer,
    ShelfRenderer,
    TileRenderer,
    ButtonRenderer
};
