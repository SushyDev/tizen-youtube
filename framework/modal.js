import { resolve as resolveCommand } from './internals.js';

// The two-panel overlay the settings and speed pickers are drawn in.
//
// `header` is either a string or `{ title, subtitle }` — both are common enough at the call sites
// that requiring one would only push the branch outwards. Anything else, including nothing at all,
// is treated as an empty header rather than thrown on: a modal with no title is still usable, and
// a picker that fails to open is not.

const headerOf = (header) => {
    if (typeof header === 'string') return { title: header, subtitle: '' };
    return header || { title: '', subtitle: '' };
};

const panelHeader = (header) => {
    const named = headerOf(header);

    // A caller may hand over the finished renderer, in which case it is used as it stands.
    const renderer = named.overlayPanelHeaderRenderer || { title: { simpleText: named.title } };

    if (named.subtitle) renderer.subtitle = { simpleText: named.subtitle };

    return renderer;
};

// `update` redraws a modal already on screen instead of opening a second one over it, which is
// what makes a settings switch flip in place rather than stacking panels.
const Modal = (header, content, id, update) => {
    const modal = {
        openPopupAction: {
            popupType: 'MODAL',
            popup: {
                overlaySectionRenderer: {
                    overlay: {
                        overlayTwoPanelRenderer: {
                            actionPanel: {
                                overlayPanelRenderer: {
                                    header: { overlayPanelHeaderRenderer: panelHeader(header) },
                                    content
                                }
                            },
                            backButton: {
                                buttonRenderer: {
                                    accessibilityData: { accessibilityData: { label: 'Back' } },
                                    command: { signalAction: { signal: 'POPUP_BACK' } }
                                }
                            }
                        }
                    },
                    dismissalCommand: { signalAction: { signal: 'POPUP_BACK' } }
                }
            },
            uniqueId: id
        }
    };

    if (update) {
        modal.openPopupAction.shouldMatchUniqueId = true;
        modal.openPopupAction.updateAction = true;
    }

    return modal;
};

const showModal = (header, content, id, update) => {
    resolveCommand(Modal(header, content, id, update));
};

export { Modal, showModal };
