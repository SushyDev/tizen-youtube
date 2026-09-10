// The shapes YouTube's own UI is made of.
//
// Every one of these returns a plain object and reaches nothing: they describe, they do not act.
// What opens a toast or a modal lives beside this in toast.js and modal.js, because resolving a
// command against the running app is a different thing from naming a shape.
//
// The names are YouTube's, not ours. A mod that builds a row builds the row the app already knows
// how to draw, so a renderer here that stops matching the set is a shape to correct rather than a
// helper to redesign.

const overlayPanelItemListRenderer = (items, selectedIndex) => ({
    overlayPanelItemListRenderer: {
        items,
        selectedIndex
    }
});

// The row style the settings and speed panels are built from. Title, icons and subtitle are all
// optional, and each is left off entirely rather than sent empty — an empty `title` draws as a
// blank line where no line was wanted.
const buttonItem = (title, icon, commands) => {
    const button = {
        compactLinkRenderer: {
            serviceEndpoint: {
                commandExecutorCommand: {
                    commands
                }
            }
        }
    };

    if (title) {
        button.compactLinkRenderer.title = { simpleText: title.title };

        if (title.subtitle) {
            button.compactLinkRenderer.subtitle = { simpleText: title.subtitle };
        }
    }

    if (icon && icon.icon) {
        button.compactLinkRenderer.icon = { iconType: icon.icon };
    }

    if (icon && icon.secondaryIcon) {
        button.compactLinkRenderer.secondaryIcon = { iconType: icon.secondaryIcon };
    }

    return button;
};

// A card that appears over the video at triggerTimeMs and leaves timeoutMs later. This is the
// shape YouTube's own "Up next" and shopping prompts arrive in, which is why the player's overlay
// mods recognise it.
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

const overlayMessageRenderer = (simpleText) => ({
    overlayMessageRenderer: {
        title: { simpleText }
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
    overlayMessageRenderer,
    ShelfRenderer,
    TileRenderer,
    ButtonRenderer
};
