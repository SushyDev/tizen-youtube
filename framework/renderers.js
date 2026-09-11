// Builders for YouTube's own renderer shapes; none touch the app.

const overlayPanelItemListRenderer = (items, selectedIndex) => ({
    overlayPanelItemListRenderer: {
        items,
        selectedIndex
    }
});

// The row style the settings and speed panels are built from. Title, icons and subtitle are all
// optional, and each is left off entirely rather than sent empty — an empty `title` draws as a
// blank line where no line was wanted.
const buttonItem = (title, icon, commands) => ({
    compactLinkRenderer: Object.assign(
        { serviceEndpoint: { commandExecutorCommand: { commands } } },
        title ? { title: { simpleText: title.title } } : {},
        title && title.subtitle ? { subtitle: { simpleText: title.subtitle } } : {},
        icon && icon.icon ? { icon: { iconType: icon.icon } } : {},
        icon && icon.secondaryIcon ? { secondaryIcon: { iconType: icon.secondaryIcon } } : {}
    )
});

// A card that appears over the video at triggerTimeMs and leaves timeoutMs later, in the shape
// YouTube's own "Up next" and shopping prompts arrive in.
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

// The two kinds of row a long-press menu holds: one that posts to the API, one that navigates.
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

// The bare renderer rather than an envelope: the transport controls hold these under `button`,
// and a caller that needs the envelope wraps it.
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
