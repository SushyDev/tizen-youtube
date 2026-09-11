import { resolve as resolveCommand } from './internals.js';

// The two-panel overlay; `header` is a string or { title, subtitle }.

const headerOf = (header) => {
    if (typeof header === 'string') return { title: header, subtitle: '' };
    return header || { title: '', subtitle: '' };
};

const panelHeader = (header) => {
    const named = headerOf(header);

    // A caller may hand over the finished renderer, in which case it is used as it stands.
    const renderer = named.overlayPanelHeaderRenderer || { title: { simpleText: named.title } };

    const subtitle = named.subtitle ? { subtitle: { simpleText: named.subtitle } } : {};

    return Object.assign({}, renderer, subtitle);
};

// `update` redraws a modal already on screen instead of opening a second one over it, which is
// what makes a settings switch flip in place rather than stacking panels.
const Modal = (header, content, id, update) => {
    const modal = {
        openPopupAction: Object.assign({
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
        }, update ? { shouldMatchUniqueId: true, updateAction: true } : {})
    };

    return modal;
};

const showModal = (header, content, id, update) => {
    resolveCommand(Modal(header, content, id, update));
};

export { Modal, showModal };
