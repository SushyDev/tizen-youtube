import { resolve as resolveCommand } from '../youtube/internals.js';

function showToast(title, subtitle, thumbnails) {
    const toastCmd = {
        openPopupAction: {
            popupType: 'TOAST',
            popup: {
                overlayToastRenderer: {
                    title: {
                        simpleText: title
                    },
                    subtitle: {
                        simpleText: subtitle
                    }
                }
            }
        }
    }

    if (thumbnails) {
        toastCmd.openPopupAction.popup.overlayToastRenderer.image = { thumbnails };
    }
    resolveCommand(toastCmd);
}

function Modal(header, content, id, update) {
    const titleSubtitleObj = typeof header === 'string' ? { title: header, subtitle: '' } : header;
    const overlayPanelHeaderRenderer = header.overlayPanelHeaderRenderer || {
        title: {
            simpleText: titleSubtitleObj.title
        }
    };
    const modalCmd = {
        openPopupAction: {
            popupType: 'MODAL',
            popup: {
                overlaySectionRenderer: {
                    overlay: {
                        overlayTwoPanelRenderer: {
                            actionPanel: {
                                overlayPanelRenderer: {
                                    header: {
                                        overlayPanelHeaderRenderer
                                    },
                                    content
                                }
                            },
                            backButton: {
                                buttonRenderer: {
                                    accessibilityData: {
                                        accessibilityData: {
                                            label: 'Back'
                                        }
                                    },
                                    command: {
                                        signalAction: {
                                            signal: 'POPUP_BACK'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    dismissalCommand: {
                        signalAction: {
                            signal: 'POPUP_BACK'
                        }
                    }
                }
            },
            uniqueId: id
        }
    }

    if (titleSubtitleObj.subtitle) {
        modalCmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.header.overlayPanelHeaderRenderer.subtitle = {
            simpleText: titleSubtitleObj.subtitle
        };
    }

    if (update) {
        modalCmd.openPopupAction.shouldMatchUniqueId = true;
        modalCmd.openPopupAction.updateAction = true;
    }

    return modalCmd;
}

function showModal(header, content, id, update) {
    const modalCmd = Modal(header, content, id, update);

    resolveCommand(modalCmd);
}

function overlayPanelItemListRenderer(items, selectedIndex) {
    return {
        overlayPanelItemListRenderer: {
            items,
            selectedIndex
        }
    }
};

function buttonItem(title, icon, commands) {
    const button = {
        compactLinkRenderer: {
            serviceEndpoint: {
                commandExecutorCommand: {
                    commands
                }
            }
        }
    }

    if (title) {
        button.compactLinkRenderer.title = {
            simpleText: title.title
        }

        if (title.subtitle) {
            button.compactLinkRenderer.subtitle = {
                simpleText: title.subtitle
            }
        }
    }

    if (icon && icon.icon) {
        button.compactLinkRenderer.icon = {
            iconType: icon.icon,
        }
    }

    if (icon && icon.secondaryIcon) {
        button.compactLinkRenderer.secondaryIcon = {
            iconType: icon.secondaryIcon,
        }
    }

    return button;
}

function timelyAction(text, icon, command, triggerTimeMs, timeoutMs) {
    return {
        timelyActionRenderer: {
            actionButtons: [
                {
                    buttonRenderer: {
                        isDisabled: false,
                        text: {
                            runs: [
                                {
                                    text: text
                                }
                            ]
                        },
                        icon: {
                            iconType: icon
                        },
                        trackingParams: null,
                        command
                    }
                }
            ],
            triggerTimeMs,
            timeoutMs,
            type: ''
        }
    }

}

function longPressData(data) {
    const isWatchLaterItem = data.watchEndpointData.playlistId === 'WL';
    const watchLaterAction = isWatchLaterItem ? {
        removedVideoId: data.videoId,
        action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID'
    } : {
        addedVideoId: data.videoId,
        action: 'ACTION_ADD_VIDEO'
    };

    return {
        clickTrackingParams: null,
        showMenuCommand: {
            contentId: data.videoId,
            thumbnail: {
                thumbnails: data.thumbnails
            },
            title: {
                simpleText: data.title
            },
            subtitle: {
                simpleText: data.subtitle
            },
            menu: {
                menuRenderer: {
                    items: [
                        MenuNavigationItemRenderer('Play', {
                            clickTrackingParams: null,
                            watchEndpoint: data.watchEndpointData
                        }),
                        MenuServiceItemRenderer(isWatchLaterItem ? 'Remove from Watch Later' : 'Save to Watch Later', {
                            clickTrackingParams: null,
                            commandMetadata: {
                                webCommandMetadata: {
                                    sendPost: true,
                                    apiUrl: '/youtubei/v1/browse/edit_playlist'
                                }
                            },
                            playlistEditEndpoint: {
                                playlistId: 'WL',
                                actions: [watchLaterAction]
                            }
                        }),
                        MenuNavigationItemRenderer('Save to Playlist', {
                            clickTrackingParams: null,
                            addToPlaylistEndpoint: {
                                videoId: data.videoId
                            }
                        }),
                        MenuServiceItemRenderer('Add to Queue', {
                            clickTrackingParams: null,
                            playlistEditEndpoint: {
                                customAction: {
                                    action: 'ADD_TO_QUEUE',
                                    parameters: data.item
                                }
                            }
                        }),
                    ],
                    trackingParams: null,
                    accessibility: {
                        accessibilityData: {
                            label: 'Video options'
                        }
                    }
                }
            }
        }
    }
}

function MenuServiceItemRenderer(text, serviceEndpoint) {
    return {
        menuServiceItemRenderer: {
            text: {
                runs: [
                    {
                        text
                    }
                ]
            },
            serviceEndpoint,
            trackingParams: null
        }
    };
}

function MenuNavigationItemRenderer(text, navigateEndpoint) {
    return {
        menuNavigationItemRenderer: {
            text: {
                runs: [
                    {
                        text
                    }
                ]
            },
            navigationEndpoint: navigateEndpoint,
            trackingParams: null
        }
    }
}

function overlayMessageRenderer(simpleText) {
    return {
        overlayMessageRenderer: {
            title: {
                simpleText
            }
        }
    }
}

function ShelfRenderer(simpleText, items, selectedIndex = 0) {
    return {
        shelfRenderer: {
            shelfHeaderRenderer: {
                title: {
                    simpleText
                }
            },
            tvhtml5ShelfRendererType: "TVHTML5_SHELF_RENDERER_TYPE_GRID",
            content: {
                horizontalListRenderer: {
                    items,
                    selectedIndex,
                    visibleItemCount: 3
                }
            }
        }
    }
}

function TileRenderer(simpleText, onSelectCommand) {
    return {
        tileRenderer: {
            contentType: "TILE_CONTENT_TYPE_VIDEO",
            metadata: {
                tileMetadataRenderer: {
                    title: {
                        simpleText
                    }
                }
            },
            onSelectCommand,
            style: "TILE_STYLE_YTLR_DEFAULT"
        }
    }
}

function ButtonRenderer(disabled, text, iconType, command) {
    return {
        isDisabled: disabled,
        text: {
            runs: [
                {
                    text: text
                }
            ]
        },
        icon: {
            iconType
        },
        command: command,
        trackingParams: null
    };
}

export {
    showToast,
    showModal,
    buttonItem,
    overlayPanelItemListRenderer,
    overlayMessageRenderer,
    timelyAction,
    longPressData,
    MenuServiceItemRenderer,
    ShelfRenderer,
    TileRenderer,
    ButtonRenderer
}
