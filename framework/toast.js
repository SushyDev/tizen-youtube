import { resolve as resolveCommand } from './internals.js';

// A toast opened through the app's own command resolver.

const showToast = (title, subtitle, thumbnails) => {
    // Left off entirely when there is none: an empty `image` draws the space for a thumbnail.
    const image = thumbnails ? { image: { thumbnails } } : {};

    const toast = {
        openPopupAction: {
            popupType: 'TOAST',
            popup: {
                overlayToastRenderer: Object.assign({
                    title: { simpleText: title },
                    subtitle: { simpleText: subtitle }
                }, image)
            }
        }
    };

    resolveCommand(toast);
};

export { showToast };
