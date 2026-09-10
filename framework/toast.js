import { resolve as resolveCommand } from './internals.js';

// The transient notice in the corner of the screen.
//
// It is opened by resolving a command rather than by touching the DOM, so it looks and behaves
// exactly like YouTube's own: the app draws it, dismisses it and stacks it.

const showToast = (title, subtitle, thumbnails) => {
    const toast = {
        openPopupAction: {
            popupType: 'TOAST',
            popup: {
                overlayToastRenderer: {
                    title: { simpleText: title },
                    subtitle: { simpleText: subtitle }
                }
            }
        }
    };

    // Left off entirely when there is none: an empty `image` draws the space for a thumbnail.
    if (thumbnails) {
        toast.openPopupAction.popup.overlayToastRenderer.image = { thumbnails };
    }

    resolveCommand(toast);
};

export { showToast };
